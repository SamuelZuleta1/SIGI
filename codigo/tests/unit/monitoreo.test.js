// HU-22 y HU-23 — incapacidades prolongadas (DS-10: registrarConcepto, registrarFaltaConcepto), con persistencia y correo falsos.
// Decisiones: DA-19 (reporte en vivo), DA-04 (correo del colaborador) y DA-46.
import { beforeEach, describe, expect, it } from 'vitest';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { ErrorDeValidacion } from '../../src/controllers/error-de-validacion.js';
import { hitoDe, leerConcepto } from '../../src/controllers/monitoreo.controller.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { formularioDeRegistro } from '../helpers/fabricas.js';
import { USUARIOS } from '../helpers/sesion-falsa.js';

let baseDeDatos;
let control;
let enviados;
let correo;

const registrar = (dias) => control.registrarIncapacidad(formularioDeRegistro({ diasIncapacidad: String(dias) }), USUARIOS.receptor);
const CONCEPTO = 'Concepto favorable de rehabilitación, pronóstico de recuperación en seis meses.';
const errores = async (promesa) => {
  const error = await promesa.catch((e) => e);
  expect(error).toBeInstanceOf(ErrorDeValidacion);
  return error.errores;
};

beforeEach(() => {
  baseDeDatos = crearBaseDeDatosFalsa();
  ({ correo, enviados } = crearCorreoFalso());
  control = crearControlIncapacidades({ baseDeDatos, correo });
});

describe('HU-22.CA1 — reporte de prolongadas en vivo (DA-19)', () => {
  it('lista solo las de más de 90 días, las más largas primero, con su hito', async () => {
    await registrar(90); // no es prolongada
    await registrar(100);
    await registrar(150);
    await registrar(200);
    const { prolongadas, conteos } = await control.consultarReporteProlongadas();
    expect(prolongadas.map((p) => [p.idIncapacidad, p.hito.clave])).toEqual([[4, 'mas_180'], [3, 'dia_120'], [2, 'mas_90']]);
    expect(conteos).toEqual({ pendientes: 3, falta: 0, con_concepto: 0 });
  });

  it('se calcula en el momento: una incapacidad que crece entra al reporte', async () => {
    await registrar(90);
    expect((await control.consultarReporteProlongadas()).prolongadas).toHaveLength(0);
    baseDeDatos.incapacidades[0].diasIncapacidad = 91;
    expect((await control.consultarReporteProlongadas()).prolongadas).toHaveLength(1);
  });

  it('las pestañas separan sin concepto, falta registrada y con concepto', async () => {
    await registrar(130);
    await registrar(130);
    await registrar(130);
    await control.registrarConcepto('1', { concepto: CONCEPTO });
    await control.registrarFaltaConcepto('2');
    expect((await control.consultarReporteProlongadas('con_concepto')).prolongadas.map((p) => p.idIncapacidad)).toEqual([1]);
    expect((await control.consultarReporteProlongadas('falta')).prolongadas.map((p) => p.idIncapacidad)).toEqual([2]);
    expect((await control.consultarReporteProlongadas('pendientes')).prolongadas.map((p) => p.idIncapacidad)).toEqual([3]);
    expect((await control.consultarReporteProlongadas('otra')).ver).toBe('pendientes');
  });

  it.each([[91, 'mas_90'], [119, 'mas_90'], [120, 'dia_120'], [180, 'dia_120'], [181, 'mas_180']])('el hito de %i días es %s', (dias, clave) => {
    expect(hitoDe(dias).clave).toBe(clave);
  });
});

describe('HU-22.CA2 — registrar el concepto', () => {
  it('lo guarda y lo comunica por correo al colaborador', async () => {
    await registrar(130);
    expect(await control.registrarConcepto('1', { concepto: `  ${CONCEPTO}  ` })).toEqual({ idIncapacidad: 1 });
    expect(baseDeDatos.incapacidades[0].concepto).toBe(CONCEPTO);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].to).toBe('ana.gomez@sigi.test');
    expect(enviados[0].text).not.toContain(CONCEPTO); // solo el aviso (DA-52)
  });

  it('el correo no lleva adjuntos (DA-12)', async () => {
    await registrar(130);
    await control.registrarConcepto('1', { concepto: CONCEPTO });
    expect(enviados[0].attachments).toBeUndefined();
  });

  it('solo una vez: un segundo concepto se rechaza y no sale otro correo', async () => {
    await registrar(130);
    await control.registrarConcepto('1', { concepto: CONCEPTO });
    expect((await errores(control.registrarConcepto('1', { concepto: CONCEPTO }))).estado).toMatch(/ya tiene el concepto/);
    expect(enviados).toHaveLength(1);
  });

  it('una incapacidad de 90 días o menos no es prolongada', async () => {
    await registrar(90);
    expect((await errores(control.registrarConcepto('1', { concepto: CONCEPTO }))).estado).toMatch(/más de 90 días/);
    expect(enviados).toHaveLength(0);
    expect(await control.prepararProlongada('1')).toBeNull();
  });

  it.each(['', '   ', 'corto', 'x'.repeat(2001), `texto válido largo\u0000`])('rechaza el concepto %j', async (concepto) => {
    await registrar(130);
    expect((await errores(control.registrarConcepto('1', { concepto }))).concepto).toBeTruthy();
    expect(baseDeDatos.incapacidades[0].concepto).toBeUndefined();
    expect(enviados).toHaveLength(0);
  });

  it('si el correo falla se deshace y se puede reintentar', async () => {
    await registrar(130);
    const fallido = crearControlIncapacidades({
      baseDeDatos,
      correo: { ...correo, comunicarConcepto: async () => { throw new Error('SMTP caído'); } },
    });
    await expect(fallido.registrarConcepto('1', { concepto: CONCEPTO })).rejects.toMatchObject({ name: 'ErrorDeAviso', deshecho: true, cause: expect.objectContaining({ message: 'SMTP caído' }) });
    expect(baseDeDatos.incapacidades[0].concepto).toBeNull();
    await control.registrarConcepto('1', { concepto: CONCEPTO });
    expect(baseDeDatos.incapacidades[0].concepto).toBe(CONCEPTO);
  });

  it('registrar el concepto resuelve la falta del concepto', async () => {
    await registrar(130);
    await control.registrarFaltaConcepto('1');
    await control.registrarConcepto('1', { concepto: CONCEPTO });
    expect(baseDeDatos.incapacidades[0]).toMatchObject({ concepto: CONCEPTO, faltaConcepto: false });
  });

  it('si el correo falla tras una falta, la falta se conserva', async () => {
    await registrar(130);
    await control.registrarFaltaConcepto('1');
    const fallido = crearControlIncapacidades({
      baseDeDatos,
      correo: { ...correo, comunicarConcepto: async () => { throw new Error('SMTP caído'); } },
    });
    await expect(fallido.registrarConcepto('1', { concepto: CONCEPTO })).rejects.toThrow();
    expect(baseDeDatos.incapacidades[0]).toMatchObject({ concepto: null, faltaConcepto: true });
  });

  it('una incapacidad que no existe devuelve null', async () => {
    expect(await control.registrarConcepto('9', { concepto: CONCEPTO })).toBeNull();
    expect(await control.registrarConcepto('abc', { concepto: CONCEPTO })).toBeNull();
  });
});

describe('DA-47 — el concepto se registra desde el día 120', () => {
  it.each([119, 120])('con %i días: %s', async (dias) => {
    await registrar(dias);
    const llega = dias >= 120;
    expect((await control.prepararProlongada('1')).puedeRegistrarConcepto).toBe(llega);
    expect((await control.prepararProlongada('1')).puedeRegistrarFalta).toBe(llega);
    if (llega) {
      await control.registrarFaltaConcepto('1');
      await control.registrarConcepto('1', { concepto: CONCEPTO });
      expect(enviados).toHaveLength(2);
    } else {
      expect((await errores(control.registrarConcepto('1', { concepto: CONCEPTO }))).estado).toMatch(/el día 120/);
      expect((await errores(control.registrarFaltaConcepto('1'))).estado).toMatch(/el día 120/);
      expect(enviados).toHaveLength(0);
      expect(baseDeDatos.incapacidades[0].concepto).toBeUndefined();
      expect(baseDeDatos.incapacidades[0].faltaConcepto).toBeUndefined();
    }
  });

  it('antes del día 120 sigue apareciendo en el reporte de prolongadas', async () => {
    await registrar(100);
    expect((await control.consultarReporteProlongadas()).prolongadas).toHaveLength(1);
  });
});

describe('HU-23.CA1 — registrar la falta del concepto', () => {
  it('la guarda y avisa por correo al colaborador', async () => {
    await registrar(130);
    expect(await control.registrarFaltaConcepto('1')).toEqual({ idIncapacidad: 1 });
    expect(baseDeDatos.incapacidades[0].faltaConcepto).toBe(true);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].to).toBe('ana.gomez@sigi.test');
    expect(enviados[0].subject).toContain('Falta el concepto');
  });

  it('solo una vez: repetirla se rechaza y no sale otro correo', async () => {
    await registrar(130);
    await control.registrarFaltaConcepto('1');
    expect((await errores(control.registrarFaltaConcepto('1'))).estado).toMatch(/Ya se registró la falta/);
    expect(enviados).toHaveLength(1);
  });

  it('con concepto ya registrado no hay falta que registrar', async () => {
    await registrar(130);
    await control.registrarConcepto('1', { concepto: CONCEPTO });
    expect((await errores(control.registrarFaltaConcepto('1'))).estado).toMatch(/no hay falta/);
  });

  it('una incapacidad que no es prolongada se rechaza', async () => {
    await registrar(60);
    expect((await errores(control.registrarFaltaConcepto('1'))).estado).toMatch(/más de 90 días/);
    expect(enviados).toHaveLength(0);
  });

  it('si el correo falla se deshace y se puede reintentar', async () => {
    await registrar(130);
    const fallido = crearControlIncapacidades({
      baseDeDatos,
      correo: { ...correo, avisarFaltaConcepto: async () => { throw new Error('SMTP caído'); } },
    });
    await expect(fallido.registrarFaltaConcepto('1')).rejects.toMatchObject({ name: 'ErrorDeAviso', deshecho: true, cause: expect.objectContaining({ message: 'SMTP caído' }) });
    expect(baseDeDatos.incapacidades[0].faltaConcepto).toBe(false);
    await control.registrarFaltaConcepto('1');
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
    expect(await control.registrarSuspensionPago('1')).toEqual({ idIncapacidad: 1 });
    expect(baseDeDatos.incapacidades[0].pagoSuspendido).toBe(true);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].to).toBe('ana.gomez@sigi.test');
    expect(enviados[0].subject).toContain('Suspensión del pago');
    expect((await control.prepararProlongada('1')).suspensionRegistrada).toBe(true);
  });

  it.each([130, 180])('con %i días no se puede suspender el pago', async (dias) => {
    await registrar(dias);
    expect((await errores(control.registrarSuspensionPago('1'))).suspension).toMatch(/supera los 180 días/);
    expect(baseDeDatos.incapacidades[0].pagoSuspendido).toBeFalsy();
  });

  it('con 181 días sí se puede', async () => {
    await registrar(181);
    expect(await control.registrarSuspensionPago('1')).toEqual({ idIncapacidad: 1 });
  });

  it('se registra una sola vez y no sale un segundo correo', async () => {
    await registrar(200);
    await control.registrarSuspensionPago('1');
    const antes = enviados.length;
    expect((await errores(control.registrarSuspensionPago('1'))).suspension).toMatch(/Ya se registró/);
    expect(enviados).toHaveLength(antes);
  });

  it('si el correo falla se deshace y se puede reintentar', async () => {
    await registrar(200);
    const original = correo.notificarSuspensionPago;
    correo.notificarSuspensionPago = async () => { throw new Error('SMTP caído'); };
    await expect(control.registrarSuspensionPago('1')).rejects.toMatchObject({ name: 'ErrorDeAviso', deshecho: true, cause: expect.objectContaining({ message: 'SMTP caído' }) });
    expect(baseDeDatos.incapacidades[0].pagoSuspendido).toBe(false);
    correo.notificarSuspensionPago = original;
    expect(await control.registrarSuspensionPago('1')).toEqual({ idIncapacidad: 1 });
  });

  it('una incapacidad inexistente o con identificador inválido devuelve null', async () => {
    expect(await control.registrarSuspensionPago('99')).toBeNull();
    expect(await control.registrarSuspensionPago('abc')).toBeNull();
  });
});
