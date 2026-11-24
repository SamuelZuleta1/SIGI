// DA-50 — prórrogas: registro (opción C), días del caso, hitos con su fecha real, reconocimiento por días del caso,
// monitoreo en el certificado vigente, alertas y reporte de prolongadas. Persistencia y correo falsos.
import { beforeEach, describe, expect, it } from 'vitest';
import { calcularVencimientos } from '../../src/controllers/alertas.controller.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { ErrorDeValidacion } from '../../src/controllers/error-de-validacion.js';
import { diaActual, fechaDelDia, fechasDelCaso, llegoAlDia } from '../../src/controllers/hitos.js';
import { calcularTramos } from '../../src/controllers/reconocimiento.controller.js';
import { clasificarPorHito, consolidarProlongadas } from '../../src/controllers/reportes.controller.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { formularioDeRegistro } from '../helpers/fabricas.js';
import { USUARIOS } from '../helpers/sesion-falsa.js';

const HOY = '2026-11-23';
const IBC_3M = 300_000_000; // $ 3.000.000 → $ 100.000 por día

let baseDeDatos;
let control;
let enviados;

const registrar = (dias, fechaInicio = '2026-04-01', cambios = {}) =>
  control.registrarIncapacidad(
    formularioDeRegistro({ diasIncapacidad: String(dias), fechaInicio, fechaRecepcion: fechaInicio, ...cambios }),
    USUARIOS.receptor,
  );
const prorrogar = (anterior, dias, fechaInicio) =>
  control.registrarProrroga(String(anterior), { fechaInicio, diasIncapacidad: String(dias), fechaRecepcion: fechaInicio }, USUARIOS.receptor);
const errores = async (promesa) => {
  const error = await promesa.catch((e) => e);
  expect(error).toBeInstanceOf(ErrorDeValidacion);
  return error.errores;
};

/**
 * El caso de ejemplo: 60 días desde el 1 abr (fin 30 may), prórroga de 40 días desde el 31 may (días 61–100, fin 9 jul)
 * y, tras 10 días de interrupción, prórroga de 60 días desde el 20 jul (días 101–160).
 */
async function casoDeEjemplo() {
  const { idIncapacidad: primera } = await registrar(60);
  const { idIncapacidad: segunda } = await prorrogar(primera, 40, '2026-05-31');
  const { idIncapacidad: tercera } = await prorrogar(segunda, 60, '2026-07-20');
  return { primera, segunda, tercera };
}

beforeEach(() => {
  baseDeDatos = crearBaseDeDatosFalsa();
  let correo;
  ({ correo, enviados } = crearCorreoFalso());
  control = crearControlIncapacidades({ baseDeDatos, correo, hoy: () => HOY });
});

describe('DA-50 — hitos con los días del caso (hitos.js)', () => {
  it('sin prórroga, el día N es inicio + N − 1 (DA-49, sin cambios)', () => {
    const i = { fechaInicio: '2026-04-01', diasIncapacidad: 130 };
    expect(fechaDelDia(i, 120)).toBe('2026-07-29');
    expect(fechaDelDia(i, 150)).toBeNull(); // no llega
  });

  it('una prórroga calcula los días que caen en ella y copia los anteriores, aunque haya interrupción', () => {
    const primera = fechasDelCaso({ fechaInicio: '2026-04-01', diasIncapacidad: 60 });
    const segunda = fechasDelCaso({ fechaInicio: '2026-05-31', diasIncapacidad: 40, diasPrevios: 60 }, primera);
    const tercera = fechasDelCaso({ fechaInicio: '2026-07-20', diasIncapacidad: 60, diasPrevios: 100 }, segunda);
    expect(segunda[90]).toBe('2026-06-29'); // día 30 de la prórroga
    expect(tercera).toEqual({ 90: '2026-06-29', 120: '2026-08-08', 150: '2026-09-07', 180: null, 181: null });
  });

  it('llegoAlDia y diaActual cuentan los días del caso', () => {
    const tercera = {
      fechaInicio: '2026-07-20', diasIncapacidad: 60, diasPrevios: 100, diasAcumulados: 160,
      fechasDia: { 90: '2026-06-29', 120: '2026-08-08', 150: '2026-09-07', 180: null, 181: null },
    };
    expect(llegoAlDia(tercera, 120, '2026-08-07')).toBe(false);
    expect(llegoAlDia(tercera, 120, '2026-08-08')).toBe(true);
    expect(llegoAlDia(tercera, 180, HOY)).toBe(false); // el caso no llega al día 180
    expect(diaActual(tercera, '2026-07-25')).toBe(106);
    expect(diaActual(tercera, HOY)).toBe(160);
  });
});

describe('DA-50 — registrar una prórroga (opción C)', () => {
  it('toma colaborador, tipo y entidad de la anterior y acumula los días del caso', async () => {
    const { primera, segunda } = await casoDeEjemplo();
    const guardada = baseDeDatos.incapacidades.find((i) => i.idIncapacidad === segunda);
    const anterior = baseDeDatos.incapacidades.find((i) => i.idIncapacidad === primera);
    expect(guardada).toMatchObject({ prorrogaDe: primera, casoId: primera, diasPrevios: 60, tipo: anterior.tipo, entidad: anterior.entidad, colaboradorId: anterior.colaboradorId, estado: null });
    expect(anterior.tieneProrroga).toBe(true);
  });

  it('prepararProrroga sugiere el día siguiente al fin y admite hasta 30 días de interrupción', async () => {
    const { idIncapacidad } = await registrar(60);
    const { anterior, impedimento } = await control.prepararProrroga(String(idIncapacidad));
    expect(anterior).toMatchObject({ fechaFin: '2026-05-30', fechaSugerida: '2026-05-31', fechaMaxima: '2026-06-30', diasCaso: 60 });
    expect(impedimento).toBeNull();
    expect(await control.prepararProrroga('99')).toBeNull();
    expect(await control.prepararProrroga('abc')).toBeNull();
  });

  it.each([
    ['2026-05-30', 'el último día de la anterior'],
    ['2026-07-01', '31 días de interrupción'],
  ])('rechaza la fecha de inicio %s (%s)', async (fechaInicio) => {
    const { idIncapacidad } = await registrar(60);
    expect((await errores(prorrogar(idIncapacidad, 10, fechaInicio))).fechaInicio).toMatch(/entre el 31 may 2026 .* y el 30 jun 2026/);
    expect(baseDeDatos.incapacidades).toHaveLength(1);
  });

  it('admite exactamente 30 días de interrupción', async () => {
    const { idIncapacidad } = await registrar(60);
    expect(await prorrogar(idIncapacidad, 10, '2026-06-30')).toEqual({ idIncapacidad: 2 });
  });

  it('valida los días y la recepción como el registro normal', async () => {
    const { idIncapacidad } = await registrar(60);
    const e = await errores(control.registrarProrroga(String(idIncapacidad), { fechaInicio: '2026-05-31', diasIncapacidad: '0' }, USUARIOS.receptor));
    expect(e).toMatchObject({ diasIncapacidad: expect.any(String), fechaRecepcion: expect.any(String) });
  });

  it('una incapacidad con prórroga no admite otra: se prorroga la última', async () => {
    const { primera, segunda } = await casoDeEjemplo();
    expect((await control.prepararProrroga(String(primera))).impedimento).toContain(`ya tiene su prórroga (n.º ${segunda})`);
    expect((await errores(prorrogar(primera, 10, '2026-05-31'))).anterior).toContain('ya tiene su prórroga');
  });

  it('una licencia no tiene prórroga', async () => {
    const { idIncapacidad } = await registrar(126, '2026-04-01', { tipo: 'licencia_maternidad' });
    expect((await errores(prorrogar(idIncapacidad, 10, '2026-08-05'))).anterior).toMatch(/licencia/);
  });

  it('si la base la rechaza (otro usuario se adelantó), explica lo que hay ahora', async () => {
    const { idIncapacidad } = await registrar(60);
    const original = baseDeDatos.guardarProrroga.bind(baseDeDatos);
    baseDeDatos.guardarProrroga = async (...args) => {
      baseDeDatos.guardarProrroga = original;
      await prorrogar(idIncapacidad, 5, '2026-05-31'); // la otra se registra primero
      return original(...args);
    };
    expect((await errores(prorrogar(idIncapacidad, 10, '2026-05-31'))).anterior).toContain('ya tiene su prórroga');
  });
});

describe('DA-50 — reconocimiento con los días del caso (HU-21)', () => {
  it('la prórroga de los días 61 a 100 no paga días a la empresa y desde el 91 aplica el 50 %', () => {
    expect(calcularTramos(40, IBC_3M, 'enfermedad_general', 60)).toMatchObject({ valorEmpresa: 0, valorEPS: 251_000_000, tramitePension: false });
  });

  it('el caso de ejemplo de la página de opciones: 30 + 30 + 40 días suman lo mismo que un certificado de 100', () => {
    const partes = [calcularTramos(30, IBC_3M, undefined, 0), calcularTramos(30, IBC_3M, undefined, 30), calcularTramos(40, IBC_3M, undefined, 60)];
    expect(partes.map((p) => [p.valorEmpresa, p.valorEPS])).toEqual([[20_000_000, 187_600_000], [0, 201_000_000], [0, 251_000_000]]);
    const total = calcularTramos(100, IBC_3M);
    expect(partes.reduce((s, p) => s + p.valorEPS, 0)).toBe(total.valorEPS);
  });

  it('una prórroga que pasa del día 180 marca el trámite de pensión y cuenta solo sus días desde el 181', () => {
    expect(calcularTramos(30, IBC_3M, 'enfermedad_general', 170)).toMatchObject({ tramitePension: true, diasPension: 20, valorEPS: 50_000_000 });
  });

  it('el control calcula la prórroga con sus días del caso', async () => {
    const { segunda } = await casoDeEjemplo();
    const r = await control.calcularReconocimiento(String(segunda), { ibc: '3.000.000' }, USUARIOS.auxiliar);
    expect(r).toMatchObject({ valorEmpresa: 0, valorEPS: 251_000_000 });
  });
});

describe('DA-50 — monitoreo en el certificado vigente (HU-22 a HU-24)', () => {
  it('tres certificados de 60, 40 y 60 días son una prolongada de 160 días, listada una sola vez', async () => {
    const { tercera } = await casoDeEjemplo();
    const { prolongadas } = await control.consultarReporteProlongadas('accion');
    expect(prolongadas.map((p) => [p.idIncapacidad, p.diasCaso, p.dia, p.hito.clave])).toEqual([[tercera, 160, 160, 'dia_150']]);
  });

  it('el concepto se registra en la vigente; en una anterior se indica la prórroga', async () => {
    const { segunda, tercera } = await casoDeEjemplo();
    expect(await control.prepararProlongada(String(segunda))).toEqual({ continuaEn: tercera });
    expect((await errores(control.registrarConcepto(String(segunda), { concepto: 'Concepto favorable de rehabilitación integral.' }, USUARIOS.auxiliar))).estado).toContain(
      `continúa en la prórroga n.º ${tercera}`,
    );
    expect(await control.registrarConcepto(String(tercera), { concepto: 'Concepto favorable de rehabilitación integral.' }, USUARIOS.auxiliar)).toEqual({ idIncapacidad: tercera });
    expect(enviados).toHaveLength(1);
  });

  it('la escritura condicionada de la base tampoco deja registrar en una anterior', async () => {
    const { segunda } = await casoDeEjemplo();
    expect(await baseDeDatos.guardarFaltaConcepto(segunda, { n: 120, hoy: HOY }, 'id-auxiliar')).toBe(false);
  });

  it('la falta del concepto registrada pasa a la prórroga', async () => {
    const { idIncapacidad } = await registrar(130); // día 120 = 29 jul
    await control.registrarFaltaConcepto(String(idIncapacidad), USUARIOS.auxiliar);
    const { idIncapacidad: prorroga } = await prorrogar(idIncapacidad, 30, '2026-08-09');
    const vista = await control.prepararProlongada(String(prorroga));
    expect(vista).toMatchObject({ estadoConcepto: 'falta', puedeRegistrarFalta: false, diasCaso: 160 });
  });
});

describe('DA-50 — alertas de hitos (HU-12) y reporte de prolongadas (HU-28)', () => {
  it('el hito 90 que cae en la prórroga aparece una vez, en la vigente', async () => {
    await registrar(60);
    await prorrogar(1, 40, '2026-05-31'); // día 90 = 29 jun
    const hitos = calcularVencimientos(await baseDeDatos.consultarPlazos(), '2026-06-26').filter((a) => a.tipo.startsWith('hito'));
    expect(hitos.map((a) => [a.idIncapacidad, a.tipo, a.fechaLimite])).toEqual([[2, 'hito90', '2026-06-29']]);
  });

  it('el reporte del mes lista el caso una vez, en su último certificado del mes, con su hito', async () => {
    await casoDeEjemplo();
    const datos = await baseDeDatos.consultarDatosProlongadas(90, '2026-07-01', '2026-07-31');
    const filas = clasificarPorHito(consolidarProlongadas(datos, '2026-07'), '2026-07', HOY);
    expect(filas.map((f) => [f.idIncapacidad, f.hito, f.diasCaso, f.diaAlCorte])).toEqual([[3, 90, 160, 112]]);
  });
});
