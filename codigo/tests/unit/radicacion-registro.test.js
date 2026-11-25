// HU-10 — registrar la radicación (DS-04: registrarRadicacion → guardarRadicacion), con persistencia falsa.
// Decisiones: DA-01 (la radicación pone estado = transcrita), DA-14 (el plazo no bloquea),
// DA-36 (solo desde registrada o rechazada), P-D (la evidencia es un archivo).
import { beforeEach, describe, expect, it } from 'vitest';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { ErrorDeValidacion } from '../../src/controllers/error-de-validacion.js';
import { puedeRadicar } from '../../src/controllers/radicacion.controller.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { formularioDeRegistro, JPG, PDF, PNG } from '../helpers/fabricas.js';
import { USUARIOS } from '../helpers/sesion-falsa.js';

let baseDeDatos;
let control;

beforeEach(async () => {
  baseDeDatos = crearBaseDeDatosFalsa();
  control = crearControlIncapacidades({ baseDeDatos, correo: crearCorreoFalso().correo, hoy: () => '2026-11-19' });
  await control.registrarIncapacidad(formularioDeRegistro(), USUARIOS.receptor);
});

const radicar = (datos = {}, id = '1') =>
  control.registrarRadicacion(id, { radicado: 'RAD-2026-001', evidencia: PDF, ...datos }, USUARIOS.auxiliar);

const errores = async (promesa) => {
  const error = await promesa.catch((e) => e);
  expect(error).toBeInstanceOf(ErrorDeValidacion);
  return error.errores;
};

describe('HU-10.CA1 — guarda la radicación y pone la incapacidad en «transcrita»', () => {
  it('HU-10.CA1 — guarda el radicado, la evidencia y quién la registró; estado → transcrita', async () => {
    const resultado = await radicar();
    expect(resultado).toEqual({ idIncapacidad: 1, idRadicacion: 1 });
    expect(baseDeDatos.incapacidades[0].estado).toBe('transcrita');
    expect(baseDeDatos.radicaciones[0]).toMatchObject({
      idIncapacidad: 1,
      radicado: 'RAD-2026-001',
      tipoMime: 'application/pdf',
      creadoPor: USUARIOS.auxiliar.id,
    });
  });

  it('HU-10.CA1 — el radicado se guarda sin espacios sobrantes', async () => {
    await radicar({ radicado: '  4455-A  ' });
    expect(baseDeDatos.radicaciones[0].radicado).toBe('4455-A');
  });

  it('HU-10.CA1 — acepta la evidencia en JPG o PNG (pantallazo del portal)', async () => {
    await radicar({ evidencia: PNG });
    expect(baseDeDatos.radicaciones[0].tipoMime).toBe('image/png');
    baseDeDatos.incapacidades[0].estado = 'rechazada';
    await radicar({ evidencia: JPG });
    expect(baseDeDatos.radicaciones[1].tipoMime).toBe('image/jpeg');
  });

  it('HU-10.CA1 — después de radicar, prepararRadicacion la muestra y ya no ofrece radicar', async () => {
    await radicar();
    const datos = await control.prepararRadicacion('1');
    expect(datos.puedeRadicar).toBe(false);
    expect(datos.incapacidad.estado).toBe('transcrita');
    expect(datos.incapacidad.radicaciones).toEqual([
      expect.objectContaining({ idRadicacion: 1, radicado: 'RAD-2026-001', conEvidencia: true }),
    ]);
  });

  it('HU-10.CA1 — DA-14: con el plazo vencido también se registra', async () => {
    await control.registrarIncapacidad(formularioDeRegistro({ fechaInicio: '2024-01-02' }), USUARIOS.receptor);
    expect((await control.prepararRadicacion('2')).plazo.estado).toBe('vencido');
    await expect(radicar({}, '2')).resolves.toEqual({ idIncapacidad: 2, idRadicacion: 1 });
  });

  it('HU-10.CA1 — incapacidad inexistente: null, sin guardar nada', async () => {
    expect(await radicar({}, '99')).toBeNull();
    expect(await radicar({}, 'abc')).toBeNull();
    expect(baseDeDatos.radicaciones).toHaveLength(0);
  });
});

describe('HU-10.CA1 — valida el radicado y la evidencia', () => {
  it('HU-10.CA1 — sin radicado ni evidencia: pide los dos y no cambia el estado', async () => {
    expect(await errores(control.registrarRadicacion('1', {}, USUARIOS.auxiliar))).toEqual({
      radicado: 'Escriba el número de radicado.',
      evidencia: 'Adjunte la evidencia de la radicación.',
    });
    expect(await errores(radicar({ radicado: '   ' }))).toEqual({ radicado: 'Escriba el número de radicado.' });
    expect(baseDeDatos.incapacidades[0].estado).toBeNull();
    expect(baseDeDatos.radicaciones).toHaveLength(0);
  });

  it('HU-10.CA1 — radicado de más de 100 caracteres', async () => {
    expect((await errores(radicar({ radicado: 'x'.repeat(101) }))).radicado).toMatch(/máximo 100/);
    await expect(radicar({ radicado: 'x'.repeat(100) })).resolves.toBeTruthy();
  });

  it('HU-10.CA1 — la evidencia debe ser PDF, JPG o PNG por su contenido, y de máximo 10 MB', async () => {
    expect(await errores(radicar({ evidencia: Buffer.from('MZ ejecutable') }))).toEqual({
      evidencia: 'La evidencia debe ser PDF, JPG o PNG.',
    });
    const grande = Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]);
    expect(await errores(radicar({ evidencia: grande }))).toEqual({ evidencia: 'El archivo pesa más de 10 MB.' });
    expect(await errores(radicar({ evidencia: Buffer.alloc(0) }))).toEqual({
      evidencia: 'Adjunte la evidencia de la radicación.',
    });
  });
});

describe('HU-10.CA2 — tras un rechazo, una nueva radicación vuelve a «transcrita»', () => {
  it('HU-10.CA2 — rechazada + nueva radicación → transcrita; quedan las dos radicaciones', async () => {
    await radicar({ radicado: 'RAD-1' });
    await control.registrarRechazo('1', { causal: 'Soporte ilegible' }); // HU-14
    expect((await control.prepararRadicacion('1')).puedeRadicar).toBe(true);
    await expect(radicar({ radicado: 'RAD-2' })).resolves.toEqual({ idIncapacidad: 1, idRadicacion: 2 });
    expect(baseDeDatos.incapacidades[0].estado).toBe('transcrita');
    const { radicaciones } = (await control.prepararRadicacion('1')).incapacidad;
    expect(radicaciones.map((r) => r.radicado)).toEqual(['RAD-1', 'RAD-2']);
  });

  it('HU-10.CA2 — DA-36: ya transcrita, no se registra una segunda radicación', async () => {
    await radicar();
    expect(await errores(radicar({ radicado: 'RAD-otra' }))).toEqual({
      estado: 'La incapacidad ya está radicada (transcrita): solo se radica una nueva tras un rechazo.',
    });
    expect(baseDeDatos.radicaciones).toHaveLength(1);
  });

  it('HU-10.CA2 — DA-36: cobrada o pagada no se radica', async () => {
    for (const estado of ['cobrada', 'pagada']) {
      baseDeDatos.incapacidades[0].estado = estado;
      expect((await errores(radicar())).estado).toMatch(`ya está ${estado}`);
    }
    expect(baseDeDatos.radicaciones).toHaveLength(0);
  });

  it('HU-10.CA2 — DA-36: si otro usuario la radicó entre la consulta y el registro, no se repite', async () => {
    const guardar = baseDeDatos.guardarRadicacion;
    baseDeDatos.guardarRadicacion = async () => null; // la transacción encontró la fila ya transcrita
    expect((await errores(radicar())).estado).toMatch('ya está radicada');
    baseDeDatos.guardarRadicacion = guardar;
  });

  it('EST-01 — puedeRadicar: solo registrada (sin estado) o rechazada', () => {
    expect([null, undefined, 'rechazada'].every((estado) => puedeRadicar(estado))).toBe(true);
    expect(['transcrita', 'cobrada', 'pagada'].some((estado) => puedeRadicar(estado))).toBe(false);
    expect(puedeRadicar('rechazada', 'Trasladada por rechazo')).toBe(false); // DA-70
  });
});

describe('Ver la evidencia de una radicación', () => {
  it('entrega el archivo con su tipo y un nombre sin datos personales', async () => {
    await radicar({ evidencia: PNG });
    const radicacion = await control.obtenerRadicacion('1');
    expect(radicacion).toMatchObject({ idRadicacion: 1, idIncapacidad: 1, radicado: 'RAD-2026-001' });
    expect(await control.verEvidencia(radicacion)).toEqual({ contenido: PNG, tipoMime: 'image/png', nombre: 'radicacion-1.png' });
  });

  it('radicación inexistente o número inválido: null', async () => {
    expect(await control.obtenerRadicacion('7')).toBeNull();
    expect(await control.obtenerRadicacion('-1')).toBeNull();
  });
});
