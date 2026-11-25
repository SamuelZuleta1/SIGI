// HU-18 — requerimientos de cobro persuasivo (DS-08: registrarRequerimiento → guardarRequerimiento),
// con persistencia falsa. Decisiones: DA-05 (solo cobradas con demora), DA-14 (el mínimo se advierte) y DA-43.
import { beforeEach, describe, expect, it } from 'vitest';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { ErrorDeValidacion } from '../../src/controllers/error-de-validacion.js';
import { leerFundamentos, REQUERIMIENTOS_MINIMOS } from '../../src/controllers/cobro-juridico.controller.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { formularioDeRegistro, PDF } from '../helpers/fabricas.js';
import { USUARIOS } from '../helpers/sesion-falsa.js';

let baseDeDatos;
let control;
let hoy;

beforeEach(async () => {
  hoy = '2026-12-04'; // prometida: 2026-12-01 → 3 días de demora
  baseDeDatos = crearBaseDeDatosFalsa();
  control = crearControlIncapacidades({ baseDeDatos, correo: crearCorreoFalso().correo, hoy: () => hoy });
  await control.registrarIncapacidad(formularioDeRegistro(), USUARIOS.receptor);
  await control.registrarRadicacion('1', { radicado: 'RAD-1', evidencia: PDF }, USUARIOS.auxiliar);
  hoy = '2026-11-21';
  await control.registrarCobrada('1', { tiempoPago: '10' });
  hoy = '2026-12-04';
});

const requerir = (fundamentos = 'Plazo vencido el 1 de diciembre; se reclama el pago de la prestación.') =>
  control.registrarRequerimiento('1', { fundamentos }, USUARIOS.auxiliar);
const errores = async (promesa) => {
  const error = await promesa.catch((e) => e);
  expect(error).toBeInstanceOf(ErrorDeValidacion);
  return error.errores;
};

describe('HU-18.CA1 — guardar los fundamentos de un requerimiento (solo cobradas, DA-05)', () => {
  it('HU-18.CA1 — con demora guarda los fundamentos y quien lo registra, sin cambiar el estado', async () => {
    expect(await requerir()).toEqual({ idIncapacidad: 1, idRequerimiento: 1, total: 1, cumpleMinimo: false });
    expect(baseDeDatos.requerimientos[0]).toMatchObject({ idIncapacidad: 1, creadoPor: 'id-auxiliar' });
    expect(baseDeDatos.incapacidades[0].estado).toBe('cobrada');
  });

  it('HU-18.CA1 — conserva los saltos de línea y recorta los espacios de los extremos', async () => {
    await requerir('  Primera razón\nSegunda razón  ');
    expect(baseDeDatos.requerimientos[0].fundamentos).toBe('Primera razón\nSegunda razón');
  });

  it('HU-18.CA1 — la pantalla trae los requerimientos del más antiguo al más reciente', async () => {
    await requerir('Primer requerimiento por la demora.');
    await requerir('Segundo requerimiento con la norma.');
    const datos = await control.prepararRequerimientos('1');
    expect(datos.incapacidad.requerimientos.map((r) => r.fundamentos)).toEqual([
      'Primer requerimiento por la demora.',
      'Segundo requerimiento con la norma.',
    ]);
    expect(datos).toMatchObject({ total: 2, puedeRegistrar: true, demora: { diasDemora: 3 } });
  });

  it('4A — una rechazada sí admite requerimientos (cambia DA-05): puede trasladarse por rechazo', async () => {
    await control.registrarIncapacidad(formularioDeRegistro({ correoColaborador: 'otro@correo.co' }), USUARIOS.receptor);
    await control.registrarRadicacion('2', { radicado: 'RAD-2', evidencia: PDF }, USUARIOS.auxiliar);
    await control.registrarRechazo('2', { causal: 'Falta la epicrisis del paciente' });
    expect(await control.registrarRequerimiento('2', { fundamentos: 'Fundamentos válidos' }, USUARIOS.auxiliar)).toMatchObject({ total: 1 });
    expect(baseDeDatos.requerimientos).toHaveLength(1);
  });

  it('DA-05 — una transcrita, una pagada y una dada de baja tampoco', async () => {
    await control.registrarIncapacidad(formularioDeRegistro({ correoColaborador: 'otro@correo.co' }), USUARIOS.receptor);
    await control.registrarRadicacion('2', { radicado: 'RAD-2', evidencia: PDF }, USUARIOS.auxiliar);
    expect((await errores(control.registrarRequerimiento('2', { fundamentos: 'Fundamentos válidos' }, USUARIOS.auxiliar))).estado).toMatch(/aún no ha respondido/);
    baseDeDatos.incapacidades[0].decision = 'dar_de_baja';
    expect((await errores(requerir())).estado).toMatch(/dio de baja/);
    baseDeDatos.incapacidades[0].decision = null;
    await control.registrarPago('1', { valor: '1.000', fechaPago: '2026-12-04' }, USUARIOS.auxiliar);
    expect((await errores(requerir())).estado).toMatch(/ya está pagada/);
    expect(baseDeDatos.requerimientos).toHaveLength(0);
  });

  it('4A — también sin demora (cambia DA-43): el día prometido ya se puede requerir', async () => {
    hoy = '2026-12-01';
    expect((await control.prepararRequerimientos('1')).puedeRegistrar).toBe(true);
    expect(await requerir()).toMatchObject({ total: 1 });
  });

  it('si a la vez se registró el pago, la transacción no guarda el requerimiento', async () => {
    const guardar = baseDeDatos.guardarRequerimiento.bind(baseDeDatos);
    baseDeDatos.guardarRequerimiento = async (...args) => {
      baseDeDatos.incapacidades[0].estado = 'pagada';
      return guardar(...args);
    };
    expect((await errores(requerir())).estado).toMatch(/ya está pagada/);
    expect(baseDeDatos.requerimientos).toHaveLength(0);
  });

  it('no existe o el número no es válido → null', async () => {
    expect(await control.registrarRequerimiento('99', { fundamentos: 'Fundamentos válidos' }, USUARIOS.auxiliar)).toBeNull();
    expect(await control.registrarRequerimiento('abc', { fundamentos: 'Fundamentos válidos' }, USUARIOS.auxiliar)).toBeNull();
    expect(await control.prepararRequerimientos('99')).toBeNull();
  });
});

describe('HU-18.CA2 — mínimo de dos requerimientos (se informa, DA-14)', () => {
  it('HU-18.CA2 — el mínimo es 2 y la respuesta dice si ya se cumple', async () => {
    expect(REQUERIMIENTOS_MINIMOS).toBe(2);
    expect((await requerir()).cumpleMinimo).toBe(false);
    expect(await requerir('Segundo requerimiento con la norma.')).toMatchObject({ total: 2, cumpleMinimo: true });
    expect(await control.prepararRequerimientos('1')).toMatchObject({ total: 2, minimo: 2, cumpleMinimo: true });
  });

  it('HU-18.CA2 — el mínimo no limita: se pueden registrar más de dos', async () => {
    for (let i = 0; i < 4; i++) await requerir(`Requerimiento número ${i + 1} de cobro.`);
    expect(baseDeDatos.requerimientos).toHaveLength(4);
  });
});

describe('HU-18.CA2 — el total de la confirmación cuenta los requerimientos simultáneos', () => {
  it('si otro auxiliar registró uno a la vez, el total los incluye', async () => {
    const guardar = baseDeDatos.guardarRequerimiento.bind(baseDeDatos);
    baseDeDatos.guardarRequerimiento = async (...args) => {
      await guardar(1, 'Registrado por otro auxiliar a la vez.', 'id-otro');
      return guardar(...args);
    };
    expect(await requerir()).toMatchObject({ total: 2, cumpleMinimo: true });
  });
});

describe('DA-43 — validación de los fundamentos', () => {
  it.each([
    ['', 'Escriba los fundamentos del requerimiento.'],
    ['   ', 'Escriba los fundamentos del requerimiento.'],
    ['corto', 'Escriba los fundamentos con al menos 10 caracteres.'],
    ['x'.repeat(2001), 'Los fundamentos admiten hasta 2000 caracteres.'],
    ['Con un carácter\u0000 de control', 'Los fundamentos tienen caracteres no válidos.'],
  ])('fundamentos «%s…» no son válidos', (texto, error) => {
    expect(leerFundamentos(texto).error).toBe(error);
  });

  it.each([['1234567890'], ['x'.repeat(2000)], ['😀'.repeat(10)], ['Línea 1\nLínea 2\tcon tabulador']])('%s sí es válido', (texto) => {
    expect(leerFundamentos(texto).valor).toBe(texto.trim());
  });

  it('un valor que no es texto no es válido', () => {
    expect(leerFundamentos(undefined).error).toBeDefined();
    expect(leerFundamentos(42).error).toBeDefined();
  });

  it('fundamentos no válidos no guardan nada', async () => {
    expect((await errores(requerir('corto'))).fundamentos).toMatch(/al menos 10/);
    expect(baseDeDatos.requerimientos).toHaveLength(0);
  });
});
