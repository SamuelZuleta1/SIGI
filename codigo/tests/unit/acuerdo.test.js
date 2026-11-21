// HU-17 — avisar el retraso y registrar el acuerdo de pago (DS-07: evaluarDemora → notificarRetraso a la
// Coordinación; registrarAcuerdo → guardarAcuerdo), con persistencia y correo falsos. Decisión: DA-42.
import { beforeEach, describe, expect, it } from 'vitest';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { ErrorDeValidacion } from '../../src/controllers/error-de-validacion.js';
import { leerFechaAcuerdo } from '../../src/controllers/seguimiento.controller.js';
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
});

const seguir = () => control.registrarSeguimiento('1', { evidencia: PDF }, USUARIOS.auxiliar);
const acordar = (fecha = '2026-12-15', valor = '1.250.000') => control.registrarAcuerdo('1', { fecha, valor }, USUARIOS.auxiliar);
const errores = async (promesa) => {
  const error = await promesa.catch((e) => e);
  expect(error).toBeInstanceOf(ErrorDeValidacion);
  return error.errores;
};

describe('HU-17.CA1 — el retraso se avisa por correo a la Coordinación', () => {
  it('HU-17.CA1 — seguimiento con demora: correo a la Coordinación con la fecha prometida y los días', async () => {
    hoy = '2026-12-04';
    const resultado = await seguir();
    expect(resultado).toMatchObject({ avisoRetraso: true, demora: { diasDemora: 3 } });
    expect(enviados).toHaveLength(1);
    expect(enviados[0].to).toBe(DESTINATARIOS.coordinacion);
    expect(enviados[0].subject).toBe('[SIGI] Retraso en el pago — incapacidad n.º 1');
    expect(enviados[0].text).toContain('Tiempo de pago informado: 10 días');
    expect(enviados[0].text).toContain('Debía pagar a más tardar: 2026-12-01');
    expect(enviados[0].text).toContain('Días de demora: 3');
    expect(enviados[0].text).toContain('Colaborador: Ana María Gómez');
  });

  it('HU-17.CA1 — sin demora (incluido el día prometido) no se avisa', async () => {
    expect((await seguir()).avisoRetraso).toBe(false);
    hoy = '2026-12-01';
    await seguir();
    expect(enviados).toHaveLength(0);
  });

  it('DA-42 — cada seguimiento con demora vuelve a avisar', async () => {
    hoy = '2026-12-04';
    await seguir();
    hoy = '2026-12-11';
    await seguir();
    expect(enviados.map((m) => m.to)).toEqual([DESTINATARIOS.coordinacion, DESTINATARIOS.coordinacion]);
    expect(enviados[1].text).toContain('Días de demora: 10');
  });

  it('DA-42 — si el correo falla no se registra el seguimiento (se puede reintentar)', async () => {
    hoy = '2026-12-04';
    const fallido = crearControlIncapacidades({
      baseDeDatos,
      correo: { notificarRetraso: async () => { throw new Error('SMTP caído'); } },
      hoy: () => hoy,
    });
    await expect(fallido.registrarSeguimiento('1', { evidencia: PDF }, USUARIOS.auxiliar)).rejects.toThrow('SMTP caído');
    expect(baseDeDatos.seguimientos).toHaveLength(0);
  });

  it('una evidencia no válida no envía el correo', async () => {
    hoy = '2026-12-04';
    await errores(control.registrarSeguimiento('1', { evidencia: Buffer.from('x') }, USUARIOS.auxiliar));
    expect(enviados).toHaveLength(0);
  });
});

describe('HU-17.CA2 — registrar el acuerdo de pago con fecha y valor', () => {
  it('HU-17.CA2 — con demora guarda la fecha, el valor y quien lo registra', async () => {
    hoy = '2026-12-04';
    expect(await acordar('2026-12-15', '1.250.000,50')).toEqual({ idIncapacidad: 1, idAcuerdo: 1 });
    expect(baseDeDatos.acuerdos[0]).toMatchObject({ idIncapacidad: 1, fecha: '2026-12-15', valor: '1250000.50', creadoPor: 'id-auxiliar' });
    expect(baseDeDatos.incapacidades[0].estado).toBe('cobrada');
    const datos = await control.prepararSeguimiento('1');
    expect(datos.incapacidad.acuerdos).toHaveLength(1);
    expect(datos.puedeRegistrarAcuerdo).toBe(true);
  });

  it('DA-42 — sin demora no admite acuerdo (y la pantalla no lo ofrece)', async () => {
    expect((await errores(acordar())).estado).toMatch(/dentro del plazo \(hasta el 1 dic 2026\)/);
    expect((await control.prepararSeguimiento('1')).puedeRegistrarAcuerdo).toBe(false);
    expect(baseDeDatos.acuerdos).toHaveLength(0);
  });

  it('DA-42 — una pagada o dada de baja no admite acuerdo', async () => {
    hoy = '2026-12-04';
    baseDeDatos.incapacidades[0].decision = 'dar_de_baja';
    expect((await errores(acordar())).estado).toMatch(/dio de baja/);
    baseDeDatos.incapacidades[0].decision = null;
    await control.registrarPago('1', { valor: '1.000', fechaPago: '2026-12-04' }, USUARIOS.auxiliar);
    expect((await errores(acordar())).estado).toMatch(/ya está pagada/);
  });

  it('si a la vez se registró el pago, la transacción no guarda el acuerdo', async () => {
    hoy = '2026-12-04';
    const guardar = baseDeDatos.guardarAcuerdo.bind(baseDeDatos);
    baseDeDatos.guardarAcuerdo = async (...args) => {
      baseDeDatos.incapacidades[0].estado = 'pagada';
      return guardar(...args);
    };
    expect((await errores(acordar())).estado).toMatch(/ya está pagada/);
    expect(baseDeDatos.acuerdos).toHaveLength(0);
  });

  it('DA-42 — informa los errores de fecha y valor a la vez', async () => {
    hoy = '2026-12-04';
    expect(await errores(acordar('', '0'))).toEqual({
      fechaAcuerdo: 'Escriba la fecha en que la entidad se comprometió a pagar.',
      valorAcuerdo: 'El valor debe ser mayor que cero.',
    });
  });

  it.each([
    ['2026-12-15', null],
    ['2026-11-21', null], // el día en que quedó cobrada
    ['2027-12-04', null], // un año después de hoy
    ['2026-02-30', 'Escriba una fecha válida (día, mes y año).'],
    ['2026-11-20', 'La fecha no puede ser anterior a la aprobación del cobro (21 nov 2026).'],
    ['2027-12-05', 'La fecha no puede ser más de un año después de hoy.'],
  ])('DA-42 — fecha del acuerdo «%s»', (texto, error) => {
    const resultado = leerFechaAcuerdo(texto, { hoy: '2026-12-04', fechaCobrada: '2026-11-21' });
    expect(resultado.error ?? null).toBe(error);
  });

  it('no existe → null', async () => {
    expect(await control.registrarAcuerdo('99', { fecha: '2026-12-15', valor: '1' }, USUARIOS.auxiliar)).toBeNull();
  });
});
