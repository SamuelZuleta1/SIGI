// HU-20 — decisión de Cartera y Jurídica (DS-08: registrarDecision → guardarDecision), con persistencia falsa.
// Decisiones: DA-18 (la baja sale de los pendientes) y DA-45 (una sola decisión, solo trasladadas, sin cambiar el estado).
import { beforeEach, describe, expect, it } from 'vitest';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { ErrorDeValidacion } from '../../src/controllers/error-de-validacion.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { formularioDeRegistro, PDF, trasladarConRequerimientos } from '../helpers/fabricas.js';
import { USUARIOS } from '../helpers/sesion-falsa.js';

let baseDeDatos;
let control;
let hoy;

beforeEach(async () => {
  hoy = '2026-11-21';
  baseDeDatos = crearBaseDeDatosFalsa();
  control = crearControlIncapacidades({ baseDeDatos, correo: crearCorreoFalso().correo, hoy: () => hoy });
  await control.registrarIncapacidad(formularioDeRegistro(), USUARIOS.receptor);
  await control.registrarRadicacion('1', { radicado: 'RAD-1', evidencia: PDF }, USUARIOS.auxiliar);
  await control.registrarCobrada('1', { tiempoPago: '10' }); // prometida: 2026-12-01
  hoy = '2026-12-04';
});

const trasladar = () => trasladarConRequerimientos(control, 1);
const decidir = (decision = 'recuperar') => control.registrarDecision('1', { decision });
const errores = async (promesa) => {
  const error = await promesa.catch((e) => e);
  expect(error).toBeInstanceOf(ErrorDeValidacion);
  return error.errores;
};

describe('HU-20.CA1 — Cartera y Jurídica registra la decisión', () => {
  it.each(['recuperar', 'dar_de_baja'])('HU-20.CA1 — registra «%s» con la fecha de hoy', async (decision) => {
    await trasladar();
    hoy = '2026-12-10';
    expect(await decidir(decision)).toEqual({ idIncapacidad: 1, decision });
    expect(baseDeDatos.incapacidades[0]).toMatchObject({ decision, fechaDecision: '2026-12-10' });
  });

  it('HU-20.CA2 — solo registra: el estado y el traslado no cambian', async () => {
    await trasladar();
    await decidir('dar_de_baja');
    expect(baseDeDatos.incapacidades[0]).toMatchObject({ estado: 'cobrada', motivoTraslado: '180 días sin pago' });
    expect(baseDeDatos.pagos).toHaveLength(0);
  });

  it('DA-18 — dar de baja la saca de los pendientes de pago; recuperar la deja', async () => {
    await trasladar();
    await decidir('recuperar');
    expect((await control.consultarPendientesDePago()).pendientes).toHaveLength(1);
    baseDeDatos.incapacidades[0].decision = null;
    baseDeDatos.incapacidades[0].fechaDecision = null;
    await decidir('dar_de_baja');
    expect((await control.consultarPendientesDePago()).pendientes).toHaveLength(0);
    expect((await control.prepararSeguimiento('1')).pendiente).toBe(false);
  });

  it('DA-45 — una sola decisión por incapacidad', async () => {
    await trasladar();
    await decidir('recuperar');
    expect((await errores(decidir('dar_de_baja'))).estado).toMatch(/Ya se registró la decisión \(recuperar el cobro\) el 4 dic 2026/);
    expect(baseDeDatos.incapacidades[0].decision).toBe('recuperar');
  });

  it('DA-45 — sin traslado no hay decisión', async () => {
    expect((await errores(decidir())).estado).toMatch(/aún no se ha trasladado/);
    expect(await control.prepararDecision('1')).toBeNull(); // Cartera no ve lo que no es suyo
    await trasladar();
    expect((await control.prepararDecision('1')).puedeDecidir).toBe(true);
    expect(baseDeDatos.incapacidades[0].decision ?? null).toBeNull();
  });

  it('DA-45 — una incapacidad pagada no admite decisión', async () => {
    await trasladar();
    await control.registrarPago('1', { valor: '1.000', fechaPago: '2026-12-04' }, USUARIOS.auxiliar);
    expect((await errores(decidir())).estado).toMatch(/ya está pagada/);
    expect(await control.prepararDecision('1')).toBeNull(); // ya no está en cobro: sale de la vista de Cartera
  });

  it('una decisión que no es una de las dos no se registra', async () => {
    await trasladar();
    for (const decision of ['', 'borrar', undefined, 5]) {
      expect((await errores(control.registrarDecision('1', { decision }))).decision).toBe('Escoja si recupera el cobro o lo da de baja.');
    }
    expect(baseDeDatos.incapacidades[0].decision ?? null).toBeNull();
  });

  it('si a la vez se pagó o decidió otro usuario, la transacción no la guarda', async () => {
    await trasladar();
    const guardar = baseDeDatos.guardarDecision.bind(baseDeDatos);
    baseDeDatos.guardarDecision = async (...args) => {
      await guardar(1, 'dar_de_baja', '2026-12-04');
      return guardar(...args);
    };
    expect((await errores(decidir('recuperar'))).estado).toMatch(/Ya se registró la decisión \(dar de baja\)/);
    expect(baseDeDatos.incapacidades[0].decision).toBe('dar_de_baja');
  });

  it('no existe o el número no es válido → null', async () => {
    expect(await control.registrarDecision('99', { decision: 'recuperar' })).toBeNull();
    expect(await control.registrarDecision('abc', { decision: 'recuperar' })).toBeNull();
    expect(await control.prepararDecision('99')).toBeNull();
  });
});

describe('HU-20 — lista de trasladadas de Cartera y Jurídica', () => {
  it('muestra las trasladadas en «esperan decisión» y, decididas, en «decididas» con los conteos', async () => {
    await control.registrarIncapacidad(formularioDeRegistro({ correoColaborador: 'otro@correo.co' }), USUARIOS.receptor);
    await control.registrarRadicacion('2', { radicado: 'RAD-2', evidencia: PDF }, USUARIOS.auxiliar);
    expect((await control.consultarTrasladadas()).conteos).toEqual({ pendientes: 0, decididas: 0 }); // nada trasladado
    await trasladar();
    expect(await control.consultarTrasladadas()).toMatchObject({
      ver: 'pendientes',
      conteos: { pendientes: 1, decididas: 0 },
      trasladadas: [{ idIncapacidad: 1, motivoTraslado: '180 días sin pago', conDemora: true, diasDemora: 3 }],
    });
    await decidir('dar_de_baja');
    const decididas = await control.consultarTrasladadas('decididas');
    expect(decididas.conteos).toEqual({ pendientes: 0, decididas: 1 });
    expect(decididas.trasladadas[0]).toMatchObject({ idIncapacidad: 1, decision: 'dar_de_baja' });
  });

  it('una pestaña desconocida cae en «pendientes»', async () => {
    expect((await control.consultarTrasladadas('otra')).ver).toBe('pendientes');
  });

  it('una pagada ya no está en la lista', async () => {
    await trasladar();
    await control.registrarPago('1', { valor: '1.000', fechaPago: '2026-12-04' }, USUARIOS.auxiliar);
    expect((await control.consultarTrasladadas()).conteos).toEqual({ pendientes: 0, decididas: 0 });
  });

  it('las más antiguas primero', async () => {
    await control.registrarIncapacidad(formularioDeRegistro({ correoColaborador: 'otro@correo.co' }), USUARIOS.receptor);
    hoy = '2026-11-21';
    await control.registrarRadicacion('2', { radicado: 'RAD-2', evidencia: PDF }, USUARIOS.auxiliar);
    await control.registrarCobrada('2', { tiempoPago: '10' });
    hoy = '2026-12-05';
    await trasladarConRequerimientos(control, 2, { motivo: 'Primera trasladada' });
    hoy = '2026-12-06';
    await trasladar();
    expect((await control.consultarTrasladadas()).trasladadas.map((t) => t.idIncapacidad)).toEqual([2, 1]);
  });
});

describe('HU-20 (auditoría, decisión 4A) — Cartera decide también sobre una rechazada trasladada por rechazo', () => {
  it('aparece en su lista, ve el rechazo y registra la decisión; el estado sigue «rechazada»', async () => {
    await control.registrarIncapacidad(formularioDeRegistro({ correoColaborador: 'otro@correo.co' }), USUARIOS.receptor);
    await control.registrarRadicacion('2', { radicado: 'RAD-2', evidencia: PDF }, USUARIOS.auxiliar);
    await control.registrarRechazo('2', { causal: 'Falta la epicrisis del paciente' });
    await trasladarConRequerimientos(control, 2, { causal: 'rechazo', motivo: 'La entidad no reconoce la epicrisis' });

    const { trasladadas } = await control.consultarTrasladadas();
    expect(trasladadas).toEqual([expect.objectContaining({ idIncapacidad: 2, estado: 'rechazada', causalTraslado: 'rechazo', conDemora: false })]);
    const pantalla = await control.prepararDecision('2');
    expect(pantalla).toMatchObject({ puedeDecidir: true, demora: null, incapacidad: { causalRechazo: 'Falta la epicrisis del paciente' } });

    expect(await control.registrarDecision('2', { decision: 'recuperar' })).toEqual({ idIncapacidad: 2, decision: 'recuperar' });
    expect(baseDeDatos.incapacidades[1]).toMatchObject({ estado: 'rechazada', decision: 'recuperar' });
  });
});
