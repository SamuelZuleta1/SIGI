// HU-22 y HU-23 — incapacidades prolongadas (DS-10: registrarConcepto, registrarFaltaConcepto), con persistencia y correo falsos.
// Decisiones: DA-19 (reporte en vivo), DA-04 (correo del colaborador), DA-47 y DA-49 (hitos por fecha).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { ErrorDeValidacion } from '../../src/controllers/error-de-validacion.js';
import { condicionDelDia } from '../../src/controllers/hitos.js';
import { hitoDe, leerConcepto } from '../../src/controllers/monitoreo.controller.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { formularioDeRegistro } from '../helpers/fabricas.js';
import { USUARIOS } from '../helpers/sesion-falsa.js';

let baseDeDatos;
let control;
let enviados;
let correo;

// Hoy fijo. Por defecto las incapacidades empiezan el 1 de abril: ya pasaron el día 120 (29 jul) y el 181 (28 sep).
const HOY = '2026-11-23';
// Cada una de otro colaborador: el mismo colaborador, tipo y fechas sería un duplicado (HU-03).
let registradas = 0;
const registrar = (dias, fechaInicio = '2026-04-01') =>
  control.registrarIncapacidad(
    formularioDeRegistro({
      diasIncapacidad: String(dias),
      fechaInicio,
      fechaRecepcion: fechaInicio,
      correoColaborador: registradas++ === 0 ? 'ana.gomez@sigi.test' : `ana.gomez${registradas}@sigi.test`,
    }),
    USUARIOS.receptor,
  );
const CONCEPTO = 'Concepto favorable de rehabilitación, pronóstico de recuperación en seis meses.';
const errores = async (promesa) => {
  const error = await promesa.catch((e) => e);
  expect(error).toBeInstanceOf(ErrorDeValidacion);
  return error.errores;
};

beforeEach(() => {
  registradas = 0;
  baseDeDatos = crearBaseDeDatosFalsa();
  ({ correo, enviados } = crearCorreoFalso());
  control = crearControlIncapacidades({ baseDeDatos, correo, hoy: () => HOY });
});

describe('HU-22.CA1 — reporte de prolongadas en vivo (DA-19)', () => {
  it('lista por duración las de más de 90 días, las más largas primero, con su hito y el día en que van', async () => {
    await registrar(90); // no es prolongada
    await registrar(100);
    await registrar(150);
    await registrar(200);
    const { ver, prolongadas, conteos } = await control.consultarReporteProlongadas();
    expect(ver).toBe('accion');
    expect(prolongadas.map((p) => [p.idIncapacidad, p.hito.clave, p.dia])).toEqual([[4, 'mas_180', 200], [3, 'dia_150', 150]]);
    expect((await control.consultarReporteProlongadas('espera')).prolongadas.map((p) => [p.idIncapacidad, p.hito.clave])).toEqual([[2, 'mas_90']]);
    expect(conteos).toEqual({ accion: 2, espera: 1, falta: 0, con_concepto: 0 });
  });

  it('se calcula en el momento: una incapacidad que crece entra al reporte', async () => {
    await registrar(90);
    expect((await control.consultarReporteProlongadas('espera')).conteos.espera).toBe(0);
    baseDeDatos.incapacidades[0].diasIncapacidad = 91;
    expect((await control.consultarReporteProlongadas('espera')).prolongadas).toHaveLength(1);
  });

  it('las pestañas separan requiere acción, falta registrada y con concepto', async () => {
    await registrar(130);
    await registrar(130);
    await registrar(130);
    await control.registrarConcepto('1', { concepto: CONCEPTO }, USUARIOS.auxiliar);
    await control.registrarFaltaConcepto('2', USUARIOS.auxiliar);
    expect((await control.consultarReporteProlongadas('con_concepto')).prolongadas.map((p) => p.idIncapacidad)).toEqual([1]);
    expect((await control.consultarReporteProlongadas('falta')).prolongadas.map((p) => p.idIncapacidad)).toEqual([2]);
    expect((await control.consultarReporteProlongadas('accion')).prolongadas.map((p) => p.idIncapacidad)).toEqual([3]);
    expect((await control.consultarReporteProlongadas('otra')).ver).toBe('accion');
  });

  it.each([[91, 'mas_90'], [119, 'mas_90'], [120, 'dia_120'], [149, 'dia_120'], [150, 'dia_150'], [180, 'dia_150'], [181, 'mas_180']])('el hito de %i días es %s', (dias, clave) => {
    expect(hitoDe(dias).clave).toBe(clave);
  });
});

describe('HU-22.CA2 — registrar el concepto', () => {
  it('lo guarda y lo comunica por correo al colaborador', async () => {
    await registrar(130);
    expect(await control.registrarConcepto('1', { concepto: `  ${CONCEPTO}  ` }, USUARIOS.auxiliar)).toEqual({ idIncapacidad: 1 });
    expect(baseDeDatos.incapacidades[0].concepto).toBe(CONCEPTO);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].to).toBe('ana.gomez@sigi.test');
    expect(enviados[0].text).not.toContain(CONCEPTO); // solo el aviso (DA-52)
  });

  it('el correo no lleva adjuntos (DA-12)', async () => {
    await registrar(130);
    await control.registrarConcepto('1', { concepto: CONCEPTO }, USUARIOS.auxiliar);
    expect(enviados[0].attachments).toBeUndefined();
  });

  it('solo una vez: un segundo concepto se rechaza y no sale otro correo', async () => {
    await registrar(130);
    await control.registrarConcepto('1', { concepto: CONCEPTO }, USUARIOS.auxiliar);
    expect((await errores(control.registrarConcepto('1', { concepto: CONCEPTO }, USUARIOS.auxiliar))).estado).toMatch(/ya tiene el concepto/);
    expect(enviados).toHaveLength(1);
  });

  it('una incapacidad de 90 días o menos no es prolongada', async () => {
    await registrar(90);
    expect((await errores(control.registrarConcepto('1', { concepto: CONCEPTO }, USUARIOS.auxiliar))).estado).toMatch(/más de 90 días/);
    expect(enviados).toHaveLength(0);
    expect(await control.prepararProlongada('1')).toBeNull();
  });

  it.each(['', '   ', 'corto', 'x'.repeat(2001), `texto válido largo\u0000`])('rechaza el concepto %j', async (concepto) => {
    await registrar(130);
    expect((await errores(control.registrarConcepto('1', { concepto }, USUARIOS.auxiliar))).concepto).toBeTruthy();
    expect(baseDeDatos.incapacidades[0].concepto).toBeUndefined();
    expect(enviados).toHaveLength(0);
  });

  it('si el correo falla se deshace y se puede reintentar', async () => {
    await registrar(130);
    const fallido = crearControlIncapacidades({
      baseDeDatos,
      correo: { ...correo, comunicarConcepto: async () => { throw new Error('SMTP caído'); } },
    });
    await expect(fallido.registrarConcepto('1', { concepto: CONCEPTO }, USUARIOS.auxiliar)).rejects.toMatchObject({ name: 'ErrorDeAviso', deshecho: true, cause: expect.objectContaining({ message: 'SMTP caído' }) });
    expect(baseDeDatos.incapacidades[0].concepto).toBeNull();
    await control.registrarConcepto('1', { concepto: CONCEPTO }, USUARIOS.auxiliar);
    expect(baseDeDatos.incapacidades[0].concepto).toBe(CONCEPTO);
  });

  it('registrar el concepto resuelve la falta del concepto', async () => {
    await registrar(130);
    await control.registrarFaltaConcepto('1', USUARIOS.auxiliar);
    await control.registrarConcepto('1', { concepto: CONCEPTO }, USUARIOS.auxiliar);
    expect(baseDeDatos.incapacidades[0]).toMatchObject({ concepto: CONCEPTO, faltaConcepto: false });
  });

  it('si el correo falla tras una falta, la falta se conserva', async () => {
    await registrar(130);
    await control.registrarFaltaConcepto('1', USUARIOS.auxiliar);
    const fallido = crearControlIncapacidades({
      baseDeDatos,
      correo: { ...correo, comunicarConcepto: async () => { throw new Error('SMTP caído'); } },
    });
    await expect(fallido.registrarConcepto('1', { concepto: CONCEPTO }, USUARIOS.auxiliar)).rejects.toThrow();
    expect(baseDeDatos.incapacidades[0]).toMatchObject({ concepto: null, faltaConcepto: true });
  });

  it('una incapacidad que no existe devuelve null', async () => {
    expect(await control.registrarConcepto('9', { concepto: CONCEPTO }, USUARIOS.auxiliar)).toBeNull();
    expect(await control.registrarConcepto('abc', { concepto: CONCEPTO }, USUARIOS.auxiliar)).toBeNull();
  });
});

describe('DA-47 — el concepto se registra solo si dura 120 días o más', () => {
  it.each([119, 120])('con %i días: %s', async (dias) => {
    await registrar(dias);
    const llega = dias >= 120;
    expect((await control.prepararProlongada('1')).puedeRegistrarConcepto).toBe(llega);
    expect((await control.prepararProlongada('1')).puedeRegistrarFalta).toBe(llega);
    if (llega) {
      await control.registrarFaltaConcepto('1', USUARIOS.auxiliar);
      await control.registrarConcepto('1', { concepto: CONCEPTO }, USUARIOS.auxiliar);
      expect(enviados).toHaveLength(2);
    } else {
      expect((await errores(control.registrarConcepto('1', { concepto: CONCEPTO }, USUARIOS.auxiliar))).estado).toMatch(/no llega al día 120/);
      expect((await errores(control.registrarFaltaConcepto('1', USUARIOS.auxiliar))).estado).toMatch(/no llega al día 120/);
      expect(enviados).toHaveLength(0);
      expect(baseDeDatos.incapacidades[0].concepto).toBeUndefined();
      expect(baseDeDatos.incapacidades[0].faltaConcepto).toBeUndefined();
    }
  });

  it('antes del día 120 sigue apareciendo en el reporte de prolongadas', async () => {
    await registrar(100);
    expect((await control.consultarReporteProlongadas('espera')).prolongadas).toHaveLength(1);
  });
});

describe('DA-49 — el día 120 y el 181 se cumplen por calendario, como las alertas', () => {
  it('una incapacidad de 150 días que empezó ayer no admite ni concepto ni falta', async () => {
    await registrar(150, '2026-11-22');
    const prolongada = await control.prepararProlongada('1');
    expect(prolongada).toMatchObject({ dia: 2, fechaDia120: '2027-03-21', puedeRegistrarConcepto: false, puedeRegistrarFalta: false });
    expect((await errores(control.registrarConcepto('1', { concepto: CONCEPTO }, USUARIOS.auxiliar))).estado).toMatch(/llega al día 120 el 21 mar 2027/);
    expect((await errores(control.registrarFaltaConcepto('1', USUARIOS.auxiliar))).estado).toMatch(/llega al día 120/);
    expect(enviados).toHaveLength(0);
    expect((await control.consultarReporteProlongadas('espera')).prolongadas.map((p) => p.idIncapacidad)).toEqual([1]);
    expect((await control.consultarReporteProlongadas('accion')).prolongadas).toHaveLength(0);
  });

  it.each([
    ['2026-07-27', true], // hoy es su día 120
    ['2026-07-28', false], // hoy es su día 119
  ])('empezó el %s: ¿admite el concepto hoy? %s', async (inicio, admite) => {
    await registrar(130, inicio);
    expect((await control.prepararProlongada('1')).puedeRegistrarConcepto).toBe(admite);
    if (admite) expect(await control.registrarFaltaConcepto('1', USUARIOS.auxiliar)).toEqual({ idIncapacidad: 1 });
    else expect((await errores(control.registrarFaltaConcepto('1', USUARIOS.auxiliar))).estado).toMatch(/llega al día 120/);
  });

  it.each([
    ['2026-05-27', true], // hoy es su día 181
    ['2026-05-28', false], // hoy es su día 180
  ])('200 días desde el %s: ¿admite la suspensión hoy? %s', async (inicio, admite) => {
    await registrar(200, inicio);
    const prolongada = await control.prepararProlongada('1');
    expect(prolongada).toMatchObject({ suspensionPendiente: admite, tramitePension: admite, mostrarSuspension: true });
    if (admite) expect(await control.registrarSuspensionPago('1', USUARIOS.auxiliar)).toEqual({ idIncapacidad: 1 });
    else expect((await errores(control.registrarSuspensionPago('1', USUARIOS.auxiliar))).suspension).toMatch(/supera los 180 días el 24 nov 2026/);
  });

  it('la escritura condicionada de la base aplica la misma regla aunque el control se salte la comprobación', async () => {
    await registrar(150, '2026-11-22');
    expect(await baseDeDatos.guardarConcepto(1, CONCEPTO, condicionDelDia(120, HOY), USUARIOS.auxiliar.id)).toBe(false);
    expect(await baseDeDatos.guardarFaltaConcepto(1, condicionDelDia(120, HOY), USUARIOS.auxiliar.id)).toBe(false);
    expect(await baseDeDatos.guardarConcepto(1, CONCEPTO, condicionDelDia(120, '2027-03-21'), USUARIOS.auxiliar.id)).toBe(true);
  });
});

describe('HU-23.CA1 — registrar la falta del concepto', () => {
  it('la guarda y avisa por correo al colaborador', async () => {
    await registrar(130);
    expect(await control.registrarFaltaConcepto('1', USUARIOS.auxiliar)).toEqual({ idIncapacidad: 1 });
    expect(baseDeDatos.incapacidades[0].faltaConcepto).toBe(true);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].to).toBe('ana.gomez@sigi.test');
    expect(enviados[0].subject).toContain('Falta el concepto');
  });

  it('solo una vez: repetirla se rechaza y no sale otro correo', async () => {
    await registrar(130);
    await control.registrarFaltaConcepto('1', USUARIOS.auxiliar);
    expect((await errores(control.registrarFaltaConcepto('1', USUARIOS.auxiliar))).estado).toMatch(/Ya se registró la falta/);
    expect(enviados).toHaveLength(1);
  });

  it('con concepto ya registrado no hay falta que registrar', async () => {
    await registrar(130);
    await control.registrarConcepto('1', { concepto: CONCEPTO }, USUARIOS.auxiliar);
    expect((await errores(control.registrarFaltaConcepto('1', USUARIOS.auxiliar))).estado).toMatch(/no hay falta/);
  });

  it('una incapacidad que no es prolongada se rechaza', async () => {
    await registrar(60);
    expect((await errores(control.registrarFaltaConcepto('1', USUARIOS.auxiliar))).estado).toMatch(/más de 90 días/);
    expect(enviados).toHaveLength(0);
  });

  it('si el correo falla se deshace y se puede reintentar', async () => {
    await registrar(130);
    const fallido = crearControlIncapacidades({
      baseDeDatos,
      correo: { ...correo, avisarFaltaConcepto: async () => { throw new Error('SMTP caído'); } },
    });
    await expect(fallido.registrarFaltaConcepto('1', USUARIOS.auxiliar)).rejects.toMatchObject({ name: 'ErrorDeAviso', deshecho: true, cause: expect.objectContaining({ message: 'SMTP caído' }) });
    expect(baseDeDatos.incapacidades[0].faltaConcepto).toBe(false);
    await control.registrarFaltaConcepto('1', USUARIOS.auxiliar);
    expect(baseDeDatos.incapacidades[0].faltaConcepto).toBe(true);
  });
});

describe('leerConcepto', () => {
  it('cuenta caracteres, no unidades UTF-16', () => {
    expect(leerConcepto('😀'.repeat(10)).valor).toBeTruthy();
    expect(leerConcepto('😀'.repeat(2000)).valor).toBeTruthy();
    expect(leerConcepto('😀'.repeat(2001)).error).toBeTruthy();
  });
});

describe('HU-24.CA1 — registrar la suspensión del pago (más de 180 días)', () => {
  it('la guarda y avisa por correo al colaborador', async () => {
    await registrar(200);
    expect(await control.registrarSuspensionPago('1', USUARIOS.auxiliar)).toEqual({ idIncapacidad: 1 });
    expect(baseDeDatos.incapacidades[0].pagoSuspendido).toBe(true);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].to).toBe('ana.gomez@sigi.test');
    expect(enviados[0].subject).toContain('Suspensión del pago');
    expect((await control.prepararProlongada('1')).suspensionRegistrada).toBe(true);
  });

  it.each([130, 180])('con %i días no se puede suspender el pago', async (dias) => {
    await registrar(dias);
    expect((await errores(control.registrarSuspensionPago('1', USUARIOS.auxiliar))).suspension).toMatch(/supera los 180 días/);
    expect(baseDeDatos.incapacidades[0].pagoSuspendido).toBeFalsy();
  });

  it('con 181 días sí se puede', async () => {
    await registrar(181);
    expect(await control.registrarSuspensionPago('1', USUARIOS.auxiliar)).toEqual({ idIncapacidad: 1 });
  });

  it('se registra una sola vez y no sale un segundo correo', async () => {
    await registrar(200);
    await control.registrarSuspensionPago('1', USUARIOS.auxiliar);
    const antes = enviados.length;
    expect((await errores(control.registrarSuspensionPago('1', USUARIOS.auxiliar))).suspension).toMatch(/Ya se registró/);
    expect(enviados).toHaveLength(antes);
  });

  it('si el correo falla se deshace y se puede reintentar', async () => {
    await registrar(200);
    const original = correo.notificarSuspensionPago;
    correo.notificarSuspensionPago = async () => { throw new Error('SMTP caído'); };
    await expect(control.registrarSuspensionPago('1', USUARIOS.auxiliar)).rejects.toMatchObject({ name: 'ErrorDeAviso', deshecho: true, cause: expect.objectContaining({ message: 'SMTP caído' }) });
    expect(baseDeDatos.incapacidades[0].pagoSuspendido).toBe(false);
    correo.notificarSuspensionPago = original;
    expect(await control.registrarSuspensionPago('1', USUARIOS.auxiliar)).toEqual({ idIncapacidad: 1 });
  });

  it('una incapacidad inexistente o con identificador inválido devuelve null', async () => {
    expect(await control.registrarSuspensionPago('99', USUARIOS.auxiliar)).toBeNull();
    expect(await control.registrarSuspensionPago('abc', USUARIOS.auxiliar)).toBeNull();
  });
});

describe('DA-23 — auditoría del concepto, la falta y la suspensión', () => {
  it('guarda quién y cuándo; el deshacer lo limpia', async () => {
    await registrar(200);
    await control.registrarFaltaConcepto('1', USUARIOS.auxiliar);
    expect(baseDeDatos.incapacidades[0]).toMatchObject({ faltaConceptoPor: USUARIOS.auxiliar.id, fechaFaltaConcepto: expect.any(String) });
    await control.registrarConcepto('1', { concepto: CONCEPTO }, USUARIOS.auxiliar);
    // La constancia de la falta se conserva aunque el concepto la resuelva.
    expect(baseDeDatos.incapacidades[0]).toMatchObject({ conceptoPor: USUARIOS.auxiliar.id, fechaConcepto: expect.any(String), fechaFaltaConcepto: expect.any(String) });
    await control.registrarSuspensionPago('1', USUARIOS.auxiliar);
    expect(baseDeDatos.incapacidades[0]).toMatchObject({ suspensionPor: USUARIOS.auxiliar.id, fechaSuspension: expect.any(String) });
    expect(await control.prepararProlongada('1')).toMatchObject({ incapacidad: { fechaConcepto: expect.any(String), fechaSuspension: expect.any(String) } });
  });

  it('si el correo falla, el deshacer también limpia la fecha y el usuario', async () => {
    await registrar(200);
    const fallido = crearControlIncapacidades({
      baseDeDatos,
      correo: { ...correo, comunicarConcepto: async () => { throw new Error('SMTP caído'); }, avisarFaltaConcepto: async () => { throw new Error('SMTP caído'); }, notificarSuspensionPago: async () => { throw new Error('SMTP caído'); } },
      hoy: () => HOY,
    });
    const silencio = vi.spyOn(console, 'error').mockImplementation(() => {});
    await fallido.registrarFaltaConcepto('1', USUARIOS.auxiliar).catch(() => {});
    await fallido.registrarConcepto('1', { concepto: CONCEPTO }, USUARIOS.auxiliar).catch(() => {});
    await fallido.registrarSuspensionPago('1', USUARIOS.auxiliar).catch(() => {});
    silencio.mockRestore();
    expect(baseDeDatos.incapacidades[0]).toMatchObject({
      concepto: null, fechaConcepto: null, conceptoPor: null,
      faltaConcepto: false, fechaFaltaConcepto: null, faltaConceptoPor: null,
      pagoSuspendido: false, fechaSuspension: null, suspensionPor: null,
    });
  });
});
