// HU-19 — trasladar a Cartera y Jurídica (DS-08: trasladarACartera → notificarTraslado → guardarTraslado), con
// persistencia y correo falsos. Decisiones: DA-05 (solo cobradas con demora), DA-14 (advertir y permitir) y DA-44.
import { beforeEach, describe, expect, it } from 'vitest';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { ErrorDeValidacion } from '../../src/controllers/error-de-validacion.js';
import { leerMotivo } from '../../src/controllers/cobro-juridico.controller.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso, DESTINATARIOS } from '../helpers/correo-falso.js';
import { formularioDeRegistro, PDF } from '../helpers/fabricas.js';
import { USUARIOS } from '../helpers/sesion-falsa.js';

let baseDeDatos;
let control;
let enviados;
let hoy;

beforeEach(async () => {
  hoy = '2026-11-21';
  baseDeDatos = crearBaseDeDatosFalsa();
  const correoFalso = crearCorreoFalso();
  enviados = correoFalso.enviados;
  control = crearControlIncapacidades({ baseDeDatos, correo: correoFalso.correo, hoy: () => hoy });
  await control.registrarIncapacidad(formularioDeRegistro(), USUARIOS.receptor);
  await control.registrarRadicacion('1', { radicado: 'RAD-1', evidencia: PDF }, USUARIOS.auxiliar);
  await control.registrarCobrada('1', { tiempoPago: '10' }); // prometida: 2026-12-01
  hoy = '2026-12-04';
});

const requerir = (n = 1) => control.registrarRequerimiento('1', { fundamentos: `Requerimiento número ${n} de cobro.` }, USUARIOS.auxiliar);
const trasladar = (motivo = '180 días sin pago') => control.trasladarACartera('1', { motivo });
const errores = async (promesa) => {
  const error = await promesa.catch((e) => e);
  expect(error).toBeInstanceOf(ErrorDeValidacion);
  return error.errores;
};

describe('HU-19.CA1 — traslado con motivo y correo a Cartera y Jurídica', () => {
  it('HU-19.CA1 — guarda el motivo y la fecha de hoy y envía el correo a Cartera con el motivo', async () => {
    await requerir(1);
    await requerir(2);
    expect(await trasladar()).toEqual({ idIncapacidad: 1, requerimientos: 2, advertencia: false });
    expect(baseDeDatos.incapacidades[0]).toMatchObject({ estado: 'cobrada', motivoTraslado: '180 días sin pago', fechaTraslado: '2026-12-04' });
    expect(enviados).toHaveLength(1);
    expect(enviados[0].to).toBe(DESTINATARIOS.cartera);
    expect(enviados[0].subject).toBe('[SIGI] Traslado a Cartera y Jurídica — incapacidad n.º 1');
    expect(enviados[0].text).toContain('Motivo: 180 días sin pago');
    expect(enviados[0].text).toContain('Colaborador: Ana María Gómez');
  });

  it('DA-14 — con menos de dos requerimientos advierte, pero traslada', async () => {
    expect(await trasladar()).toMatchObject({ requerimientos: 0, advertencia: true });
    await requerir(1).catch(() => {}); // ya trasladada: no admite más requerimientos
    expect(baseDeDatos.incapacidades[0].motivoTraslado).toBe('180 días sin pago');
    const datos = await control.prepararRequerimientos('1');
    expect(datos).toMatchObject({ trasladada: true, puedeTrasladar: false, puedeRegistrar: false });
  });

  it('DA-14 — la pantalla advierte el mínimo antes de trasladar y deja de advertir con dos', async () => {
    await requerir(1);
    expect(await control.prepararRequerimientos('1')).toMatchObject({ puedeTrasladar: true, advertirMinimo: true });
    await requerir(2);
    expect(await control.prepararRequerimientos('1')).toMatchObject({ puedeTrasladar: true, advertirMinimo: false });
  });

  it('DA-44 — un solo traslado por incapacidad', async () => {
    await trasladar();
    expect((await errores(trasladar('Otro motivo distinto'))).estado).toMatch(/ya se trasladó a Cartera y Jurídica el 4 dic 2026/);
    expect(enviados).toHaveLength(1);
    expect((await errores(requerir(3))).estado).toMatch(/ya se trasladó/);
  });

  it('DA-05 — sin demora no se traslada (y no se envía el correo)', async () => {
    hoy = '2026-12-01';
    expect((await errores(trasladar())).estado).toMatch(/dentro del plazo/);
    expect((await control.prepararRequerimientos('1')).puedeTrasladar).toBe(false);
    expect(enviados).toHaveLength(0);
  });

  it('DA-05 — una rechazada, una transcrita, una pagada o una dada de baja no se trasladan', async () => {
    await control.registrarIncapacidad(formularioDeRegistro({ correoColaborador: 'otro@correo.co' }), USUARIOS.receptor);
    await control.registrarRadicacion('2', { radicado: 'RAD-2', evidencia: PDF }, USUARIOS.auxiliar);
    expect((await errores(control.trasladarACartera('2', { motivo: '180 días sin pago' }))).estado).toMatch(/no ha aprobado/);
    await control.registrarRechazo('2', { causal: 'Falta la epicrisis del paciente' });
    expect((await errores(control.trasladarACartera('2', { motivo: '180 días sin pago' }))).estado).toMatch(/rechazó/);
    baseDeDatos.incapacidades[0].decision = 'dar_de_baja';
    expect((await errores(trasladar())).estado).toMatch(/dio de baja/);
    baseDeDatos.incapacidades[0].decision = null;
    await control.registrarPago('1', { valor: '1.000', fechaPago: '2026-12-04' }, USUARIOS.auxiliar);
    expect((await errores(trasladar())).estado).toMatch(/ya está pagada/);
    expect(enviados).toHaveLength(0);
  });

  it('DA-44 — si el correo falla se deshace el traslado y se puede reintentar', async () => {
    const fallido = crearControlIncapacidades({
      baseDeDatos,
      correo: { notificarTraslado: async () => { throw new Error('SMTP caído'); } },
      hoy: () => hoy,
    });
    await expect(fallido.trasladarACartera('1', { motivo: '180 días sin pago' })).rejects.toThrow('SMTP caído');
    expect(baseDeDatos.incapacidades[0].motivoTraslado ?? null).toBeNull();
    expect(baseDeDatos.incapacidades[0].fechaTraslado ?? null).toBeNull();
    expect(await trasladar()).toMatchObject({ idIncapacidad: 1 });
  });

  it('un motivo no válido no envía el correo ni guarda', async () => {
    expect((await errores(trasladar('  '))).motivo).toBe('Escriba el motivo del traslado.');
    expect(enviados).toHaveLength(0);
    expect(baseDeDatos.incapacidades[0].motivoTraslado ?? null).toBeNull();
  });

  it('si a la vez se registró el pago, la transacción no guarda el traslado', async () => {
    const guardar = baseDeDatos.guardarTraslado.bind(baseDeDatos);
    baseDeDatos.guardarTraslado = async (...args) => {
      baseDeDatos.incapacidades[0].estado = 'pagada';
      return guardar(...args);
    };
    expect((await errores(trasladar())).estado).toMatch(/ya está pagada/);
    expect(baseDeDatos.incapacidades[0].motivoTraslado ?? null).toBeNull();
    expect(enviados).toHaveLength(0); // no sale un correo de más
  });

  it('si otro usuario trasladó a la vez, el mensaje lo dice', async () => {
    const guardar = baseDeDatos.guardarTraslado.bind(baseDeDatos);
    baseDeDatos.guardarTraslado = async (...args) => {
      await guardar(1, 'Trasladada por otro auxiliar', '2026-12-04');
      return guardar(...args);
    };
    expect((await errores(trasladar())).estado).toMatch(/ya se trasladó/);
    expect(enviados).toHaveLength(0); // no sale un correo de más
  });

  it('no existe o el número no es válido → null', async () => {
    expect(await control.trasladarACartera('99', { motivo: '180 días sin pago' })).toBeNull();
    expect(await control.trasladarACartera('abc', { motivo: '180 días sin pago' })).toBeNull();
  });
});

describe('HU-19.CA2 — el pago posterior al traslado usa registrarPago (HU-15)', () => {
  it('HU-19.CA2 — trasladada y pendiente: la pantalla ofrece el pago, y registrarlo deja la incapacidad pagada', async () => {
    await trasladar();
    expect((await control.prepararRequerimientos('1')).puedeRegistrarPago).toBe(true);
    hoy = '2026-12-10';
    await control.registrarPago('1', { valor: '1.250.000', fechaPago: '2026-12-10' }, USUARIOS.auxiliar);
    expect(baseDeDatos.incapacidades[0].estado).toBe('pagada');
    expect(baseDeDatos.pagos).toHaveLength(1);
    expect(await control.prepararRequerimientos('1')).toMatchObject({ puedeRegistrarPago: false, trasladada: true });
  });

  it('sin traslado no se ofrece el pago en esta pantalla', async () => {
    expect((await control.prepararRequerimientos('1')).puedeRegistrarPago).toBe(false);
  });
});

describe('DA-44 — validación del motivo', () => {
  it.each([
    ['', 'Escriba el motivo del traslado.'],
    ['ab', 'Escriba el motivo con al menos 3 caracteres.'],
    ['x'.repeat(501), 'El motivo admite hasta 500 caracteres.'],
    ['Motivo\u0000 con control', 'El motivo tiene caracteres no válidos.'],
  ])('motivo «%s…» no es válido', (texto, error) => {
    expect(leerMotivo(texto).error).toBe(error);
  });

  it.each([['abc'], ['x'.repeat(500)], ['😀😀😀'], ['180 días\nsin pago']])('%s sí es válido', (texto) => {
    expect(leerMotivo(texto).valor).toBe(texto);
  });

  it('un valor que no es texto no es válido', () => {
    expect(leerMotivo(undefined).error).toBeDefined();
  });
});
