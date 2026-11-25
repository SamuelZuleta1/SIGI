// HU-16 — seguimiento semanal del cobro (DS-07: consultarPendientesDePago → obtenerPendientes → consultarCobradas;
// registrarSeguimiento → guardarSeguimiento → evaluarDemora), con persistencia falsa.
// Decisiones: DA-18 (sin las dadas de baja), DA-38 (fecha prometida), DA-41 (semana, pestañas, evidencia obligatoria).
import { beforeEach, describe, expect, it } from 'vitest';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { ErrorDeValidacion } from '../../src/controllers/error-de-validacion.js';
import { evaluarDemora, tocaSeguimiento } from '../../src/controllers/seguimiento.controller.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { formularioDeRegistro, PDF, PNG } from '../helpers/fabricas.js';
import { USUARIOS } from '../helpers/sesion-falsa.js';

let baseDeDatos;
let control;
let hoy;

beforeEach(() => {
  registradas = 0;
  hoy = '2026-11-21';
  baseDeDatos = crearBaseDeDatosFalsa();
  control = crearControlIncapacidades({ baseDeDatos, correo: crearCorreoFalso().correo, hoy: () => hoy });
});

/** Registra, radica y cobra una incapacidad el día `hoy` con `tiempoPago` días. */
// Cada una de otro colaborador: el mismo colaborador, tipo y fechas sería un duplicado (HU-03).
let registradas = 0;
const cobrada = async ({ tiempoPago = '30', ...cambios } = {}) => {
  const { idIncapacidad } = await control.registrarIncapacidad(
    formularioDeRegistro({ correoColaborador: registradas++ === 0 ? 'ana.gomez@sigi.test' : `ana.gomez${registradas}@sigi.test`, ...cambios }),
    USUARIOS.receptor,
  );
  await control.registrarRadicacion(String(idIncapacidad), { radicado: `RAD-${idIncapacidad}`, evidencia: PDF }, USUARIOS.auxiliar);
  await control.registrarCobrada(String(idIncapacidad), { tiempoPago });
  return idIncapacidad;
};
const seguir = (id = 1, evidencia = PDF) => control.registrarSeguimiento(String(id), { evidencia }, USUARIOS.auxiliar);

const errores = async (promesa) => {
  const error = await promesa.catch((e) => e);
  expect(error).toBeInstanceOf(ErrorDeValidacion);
  return error.errores;
};

describe('HU-16.CA1 — lista de las cobradas pendientes de pago', () => {
  it('HU-16.CA1 — muestra solo las cobradas, con la fecha prometida', async () => {
    await cobrada();
    const { idIncapacidad: sinRadicar } = await control.registrarIncapacidad(
      formularioDeRegistro({ correoColaborador: 'otro@sigi.test' }),
      USUARIOS.receptor,
    );
    const { pendientes, conteos } = await control.consultarPendientesDePago();
    expect(pendientes.map((p) => p.idIncapacidad)).toEqual([1]);
    expect(pendientes.map((p) => p.idIncapacidad)).not.toContain(sinRadicar);
    expect(pendientes[0]).toMatchObject({ colaborador: 'Ana María Gómez', entidad: 'Nueva EPS', fechaPrometida: '2026-12-21', conDemora: false });
    expect(conteos).toEqual({ todas: 1, demora: 0, semana: 0 }); // recién cobrada: aún no toca (DA-41)
  });

  it('HU-16.CA1 — una pagada sale de la lista', async () => {
    await cobrada();
    await control.registrarPago('1', { valor: '1.000.000', fechaPago: '2026-11-21' }, USUARIOS.auxiliar);
    expect((await control.consultarPendientesDePago()).pendientes).toEqual([]);
  });

  it('DA-18 — las dadas de baja no aparecen en los pendientes', async () => {
    await cobrada();
    await cobrada();
    baseDeDatos.incapacidades[0].decision = 'dar_de_baja';
    baseDeDatos.incapacidades[1].decision = 'recuperar';
    const { pendientes } = await control.consultarPendientesDePago();
    expect(pendientes.map((p) => p.idIncapacidad)).toEqual([2]);
  });

  it('HU-16.CA1 — primero la de más demora, luego las que vencen antes', async () => {
    await cobrada({ tiempoPago: '60' }); // 2027-01-20
    await cobrada({ tiempoPago: '15' }); // 2026-12-06
    hoy = '2026-11-01';
    await cobrada({ tiempoPago: '10', fechaInicio: '2026-10-20' }); // 2026-11-11: con demora el 21
    hoy = '2026-11-21';
    const { pendientes } = await control.consultarPendientesDePago();
    expect(pendientes.map((p) => p.idIncapacidad)).toEqual([3, 2, 1]);
    expect(pendientes[0]).toMatchObject({ conDemora: true, diasDemora: 10 });
  });

  it('DA-41 — pestañas: con demora y las que no tienen seguimiento esta semana', async () => {
    hoy = '2026-11-01';
    await cobrada({ tiempoPago: '10', fechaInicio: '2026-10-20' });
    await cobrada({ tiempoPago: '90', fechaInicio: '2026-10-20' });
    hoy = '2026-11-21';
    baseDeDatos.fechaSeguimiento = '2026-11-20T15:00:00.000Z';
    await seguir(2);
    expect((await control.consultarPendientesDePago('demora')).pendientes.map((p) => p.idIncapacidad)).toEqual([1]);
    expect((await control.consultarPendientesDePago('semana')).pendientes.map((p) => p.idIncapacidad)).toEqual([1]);
    const todas = await control.consultarPendientesDePago('__proto__');
    expect(todas.ver).toBe('todas');
    expect(todas.pendientes).toHaveLength(2);
    expect(todas.conteos).toEqual({ todas: 2, demora: 1, semana: 1 });
  });

  it('HU-16.CA1 — el último seguimiento se muestra como fecha de Colombia', async () => {
    await cobrada();
    baseDeDatos.fechaSeguimiento = '2026-11-21T03:00:00.000Z'; // 20 de noviembre, 10 p. m. en Colombia
    await seguir();
    const [p] = (await control.consultarPendientesDePago()).pendientes;
    expect(p.ultimoSeguimiento).toBe('2026-11-20');
  });

  it('HU-11.CA2 / solo consulta — la lista no escribe nada', async () => {
    await cobrada();
    const antes = JSON.stringify(baseDeDatos.incapacidades);
    await control.consultarPendientesDePago();
    expect(JSON.stringify(baseDeDatos.incapacidades)).toBe(antes);
    expect(baseDeDatos.seguimientos).toHaveLength(0);
  });
});

describe('HU-16.CA3 — seguimiento con evidencia y evaluarDemora', () => {
  it('HU-16.CA3 — sin demora: guarda la evidencia y quien registra, e informa que está dentro del plazo', async () => {
    await cobrada();
    const resultado = await seguir();
    expect(resultado).toMatchObject({ idIncapacidad: 1, idSeguimiento: 1, demora: { conDemora: false, diasRestantes: 30 } });
    expect(baseDeDatos.seguimientos[0]).toMatchObject({ idIncapacidad: 1, tipoMime: 'application/pdf', creadoPor: 'id-auxiliar' });
    expect(baseDeDatos.incapacidades[0].estado).toBe('cobrada');
  });

  it('HU-16.CA3 — con demora: evalúa los días que pasaron de la fecha prometida', async () => {
    await cobrada();
    hoy = '2026-12-24';
    const { demora } = await seguir(1, PNG);
    expect(demora).toEqual({ fechaPrometida: '2026-12-21', conDemora: true, diasDemora: 3, diasRestantes: 0 });
  });

  it('DS-07 evaluarDemora — la entidad tiene todo el día prometido; hay demora desde el siguiente', () => {
    const cobro = { fechaCobrada: '2026-11-21', tiempoPago: 30 };
    expect(evaluarDemora(cobro, '2026-12-21')).toMatchObject({ conDemora: false, diasDemora: 0, diasRestantes: 0 });
    expect(evaluarDemora(cobro, '2026-12-22')).toMatchObject({ conDemora: true, diasDemora: 1 });
    expect(evaluarDemora(cobro, '2026-12-01')).toMatchObject({ conDemora: false, diasRestantes: 20 });
  });

  it('DA-41 — toca si el último seguimiento (o, sin ninguno, la cobrada) tiene 7 días o más', () => {
    expect(tocaSeguimiento(null, '2026-11-14', '2026-11-21')).toBe(true);
    expect(tocaSeguimiento(null, '2026-11-15', '2026-11-21')).toBe(false);
    expect(tocaSeguimiento('2026-11-14', '2026-11-01', '2026-11-21')).toBe(true);
    expect(tocaSeguimiento('2026-11-15', '2026-11-01', '2026-11-21')).toBe(false);
  });

  it('HU-16.CA3 — prepararSeguimiento muestra cada seguimiento con la demora de ese día', async () => {
    await cobrada({ tiempoPago: '10' });
    baseDeDatos.fechaSeguimiento = '2026-11-25T15:00:00.000Z';
    await seguir();
    baseDeDatos.fechaSeguimiento = '2026-12-04T15:00:00.000Z';
    hoy = '2026-12-04';
    await seguir();
    const datos = await control.prepararSeguimiento('1');
    expect(datos.incapacidad.seguimientos.map((s) => [s.dia, s.diasDemora])).toEqual([['2026-11-25', 0], ['2026-12-04', 3]]);
    expect(datos).toMatchObject({ pendiente: true, tocaSeguimiento: false, demora: { conDemora: true, diasDemora: 3 } });
  });

  it.each([
    [null, 'Adjunte la evidencia de la gestión (correo, pantallazo o respuesta de la entidad).'],
    [Buffer.alloc(0), 'Adjunte la evidencia de la gestión (correo, pantallazo o respuesta de la entidad).'],
    [Buffer.from('texto plano'), 'La evidencia debe ser PDF, JPG o PNG.'],
    [Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]), 'El archivo pesa más de 10 MB.'],
  ])('P-D — evidencia no válida (%#): no guarda nada', async (evidencia, mensaje) => {
    await cobrada();
    expect(await errores(seguir(1, evidencia))).toEqual({ evidencia: mensaje });
    expect(baseDeDatos.seguimientos).toHaveLength(0);
  });
});

describe('HU-16 — solo las pendientes de pago admiten seguimiento', () => {
  it.each([
    ['registrada', async () => control.registrarIncapacidad(formularioDeRegistro(), USUARIOS.receptor), /aún no se ha radicado/],
    ['pagada', async () => {
      await cobrada();
      await control.registrarPago('1', { valor: '1.000', fechaPago: '2026-11-21' }, USUARIOS.auxiliar);
    }, /ya está pagada/],
    ['dada de baja', async () => {
      await cobrada();
      baseDeDatos.incapacidades[0].decision = 'dar_de_baja';
    }, /dio de baja/],
  ])('%s → error de estado', async (_, preparar, mensaje) => {
    await preparar();
    expect((await errores(seguir())).estado).toMatch(mensaje);
    expect(baseDeDatos.seguimientos).toHaveLength(0);
  });

  it('si a la vez se registró el pago, la transacción no guarda y se informa', async () => {
    await cobrada();
    const guardar = baseDeDatos.guardarSeguimiento.bind(baseDeDatos);
    baseDeDatos.guardarSeguimiento = async (...args) => {
      baseDeDatos.incapacidades[0].estado = 'pagada';
      return guardar(...args);
    };
    expect((await errores(seguir())).estado).toMatch(/ya está pagada/);
  });

  it('prepararSeguimiento de una pagada: no pendiente y con el mensaje', async () => {
    await cobrada();
    await control.registrarPago('1', { valor: '1.000', fechaPago: '2026-11-21' }, USUARIOS.auxiliar);
    expect(await control.prepararSeguimiento('1')).toMatchObject({ pendiente: false, tocaSeguimiento: false, mensajeEstado: expect.stringMatching(/pagada/) });
  });

  it('no existe o id no válido → null', async () => {
    expect(await seguir(99)).toBeNull();
    expect(await control.prepararSeguimiento('abc')).toBeNull();
    expect(await control.obtenerSeguimiento('1; drop')).toBeNull();
  });
});
