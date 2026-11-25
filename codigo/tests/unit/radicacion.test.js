// HU-09 — preparar la radicación con su plazo (DS-04, CU-06): Control con persistencia falsa.
// Decisiones: DA-13 (fechas y «por vencer» = 5 días), DA-14 (advierte y no bloquea), DA-17 (canal y estado
// del plazo), DA-35 (paternidad sin fecha de nacimiento: desde el inicio; «por vencer» en días calendario).
import { beforeEach, describe, expect, it } from 'vitest';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import {
  calcularPlazoRadicacion,
  describirIntervalo,
  leerIntervalo,
} from '../../src/controllers/radicacion.controller.js';
import { sumarIntervalo } from '../../src/servicios/dias-habiles.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { documentoDePrueba, formularioDeRegistro } from '../helpers/fabricas.js';
import { USUARIOS } from '../helpers/sesion-falsa.js';

let baseDeDatos;
let control;
let hoy;

// Entidades de la base falsa: 1 ARL SURA, 2 Nueva EPS (12 meses), 3 Sanitas (3 años, solo por correo),
// 4 Salud Total (12 meses; tránsito, 15 días).
beforeEach(() => {
  baseDeDatos = crearBaseDeDatosFalsa();
  hoy = '2026-11-19';
  control = crearControlIncapacidades({ baseDeDatos, correo: crearCorreoFalso().correo, hoy: () => hoy });
});

const registrar = (cambios) => control.registrarIncapacidad(formularioDeRegistro(cambios), USUARIOS.receptor);

describe('HU-09.CA1 — muestra la entidad, el canal y el plazo', () => {
  it('HU-09.CA1 — entidad con transcripción digital: plazo = inicio + 12 meses', async () => {
    await registrar({ entidad: '2', fechaInicio: '2026-11-03' });
    const datos = await control.prepararRadicacion('1');
    expect(datos.incapacidad).toMatchObject({ idIncapacidad: 1, colaborador: 'Ana María Gómez', tipo: 'enfermedad_general' });
    expect(datos.entidad).toEqual({ nombre: 'Nueva EPS', tipo: 'EPS', permiteTranscripcionDigital: true });
    expect(datos.plazo).toEqual({
      regla: 'entidad',
      duracion: '12 meses',
      desde: '2026-11-03',
      base: 'inicio',
      fechaLimite: '2027-11-03',
      diasTotales: 365,
      diasRestantes: 349,
      estado: 'al_dia',
    });
  });

  it('HU-09.CA1 — entidad que exige correo (Sanitas): canal por correo y plazo de 3 años', async () => {
    await registrar({ entidad: '3', fechaInicio: '2026-11-03' });
    const { entidad, plazo } = await control.prepararRadicacion(1);
    expect(entidad.permiteTranscripcionDigital).toBe(false);
    expect(plazo).toMatchObject({ duracion: '3 años', fechaLimite: '2029-11-03' });
  });

  it('HU-09.CA1 — accidente de tránsito en Salud Total: plazo propio de 15 días (P-C)', async () => {
    await registrar({ entidad: '4', tipo: 'accidente_transito', fechaInicio: '2026-11-10' });
    const { plazo } = await control.prepararRadicacion(1);
    expect(plazo).toMatchObject({ regla: 'transito', duracion: '15 días', fechaLimite: '2026-11-25', diasTotales: 15, diasRestantes: 6, estado: 'al_dia' });
  });

  it('HU-09.CA1 — accidente de tránsito en una entidad sin plazo de tránsito: el plazo general', async () => {
    await registrar({ entidad: '2', tipo: 'accidente_transito', fechaInicio: '2026-11-10' });
    expect((await control.prepararRadicacion(1)).plazo).toMatchObject({ regla: 'entidad', fechaLimite: '2027-11-10' });
  });

  it('HU-09.CA1 — otro tipo en Salud Total: el plazo general de 12 meses', async () => {
    await registrar({ entidad: '4', fechaInicio: '2026-11-10' });
    expect((await control.prepararRadicacion(1)).plazo).toMatchObject({ regla: 'entidad', fechaLimite: '2027-11-10' });
  });

  it('HU-09.CA1 — paternidad sin fecha de nacimiento: 30 días desde el inicio de la licencia (DA-35)', async () => {
    await registrar({ entidad: '2', tipo: 'licencia_paternidad', fechaInicio: '2026-11-01', diasIncapacidad: '14' });
    // Licencia registrada antes de la auditoría (HU-12), cuando el registro aún no pedía la fecha de nacimiento.
    baseDeDatos.incapacidades[0].fechaNacimiento = null;
    const { plazo } = await control.prepararRadicacion(1);
    expect(plazo).toMatchObject({ regla: 'paternidad', duracion: '30 días', base: 'inicio', fechaLimite: '2026-12-01' });
  });

  it('HU-09.CA1 — paternidad con fecha de nacimiento: 30 días desde el nacimiento (DA-13)', async () => {
    await registrar({ entidad: '2', tipo: 'licencia_paternidad', fechaInicio: '2026-11-01', diasIncapacidad: '14', fechaNacimiento: '2026-10-30' });
    expect(baseDeDatos.incapacidades[0].fechaNacimiento).toBe('2026-10-30'); // HU-12: la escribe el registro
    const { plazo } = await control.prepararRadicacion(1);
    expect(plazo).toMatchObject({ base: 'nacimiento', desde: '2026-10-30', fechaLimite: '2026-11-29' });
  });

  it('HU-09.CA1 — no existe la incapacidad o el número no es válido → null', async () => {
    expect(await control.prepararRadicacion(99)).toBeNull();
    expect(await control.prepararRadicacion('abc')).toBeNull();
  });

  it('HU-09.CA1 — solo consulta: no cambia la incapacidad', async () => {
    await registrar({ entidad: '2' });
    const antes = structuredClone(baseDeDatos.incapacidades);
    await control.prepararRadicacion(1);
    expect(baseDeDatos.incapacidades).toEqual(antes);
  });
});

describe('HU-09.CA2 — por vencer o vencido se advierte, sin bloquear', () => {
  // Salud Total, tránsito: inicio 10 de noviembre → vence el miércoles 25 de noviembre.
  beforeEach(() => registrar({ entidad: '4', tipo: 'accidente_transito', fechaInicio: '2026-11-10' }));

  it.each([
    ['2026-11-19', 'al_dia', 6],
    ['2026-11-20', 'por_vencer', 5],
    ['2026-11-25', 'por_vencer', 0], // la entidad recibe todo el día límite
    ['2026-11-26', 'vencido', -1],
  ])('HU-09.CA2 — hoy %s → %s (%i días)', async (fecha, estado, diasRestantes) => {
    hoy = fecha;
    expect((await control.prepararRadicacion(1)).plazo).toMatchObject({ estado, diasRestantes });
  });

  it('HU-09.CA2 / DA-14 — sin verificar la documentación lo advierte; ya archivada, no', async () => {
    expect((await control.prepararRadicacion(1)).sinVerificar).toBe(true);
    await control.registrarDocumentos(1, [documentoDePrueba(), documentoDePrueba({ tipo: 'epicrisis' }), documentoDePrueba({ tipo: 'furips' })], USUARIOS.receptor);
    await control.registrarVerificacion(1);
    expect((await control.prepararRadicacion(1)).sinVerificar).toBe(false);
  });
});

describe('DA-13 — fechas de los plazos en días calendario', () => {
  it('leerIntervalo entiende el texto de Postgres', () => {
    expect(leerIntervalo('1 year')).toEqual({ anios: 1, meses: 0, dias: 0 });
    expect(leerIntervalo('3 years')).toEqual({ anios: 3, meses: 0, dias: 0 });
    expect(leerIntervalo('150 days')).toEqual({ anios: 0, meses: 0, dias: 150 });
    expect(leerIntervalo('1 year 2 mons 3 days')).toEqual({ anios: 1, meses: 2, dias: 3 });
    expect(leerIntervalo(null)).toBeNull();
    expect(leerIntervalo('00:00:00')).toBeNull();
  });

  it('describirIntervalo lo dice como el procedimiento', () => {
    expect(describirIntervalo({ anios: 1, meses: 0, dias: 0 })).toBe('12 meses');
    expect(describirIntervalo({ anios: 3, meses: 0, dias: 0 })).toBe('3 años');
    expect(describirIntervalo({ anios: 0, meses: 0, dias: 150 })).toBe('150 días');
    expect(describirIntervalo({ anios: 1, meses: 2, dias: 0 })).toBe('14 meses');
    expect(describirIntervalo({ anios: 0, meses: 1, dias: 1 })).toBe('1 mes y 1 día');
  });

  it('sumarIntervalo ajusta al último día del mes, como Postgres', () => {
    expect(sumarIntervalo('2026-01-31', { meses: 1 })).toBe('2026-02-28');
    expect(sumarIntervalo('2028-02-29', { anios: 1 })).toBe('2029-02-28');
    expect(sumarIntervalo('2026-11-03', { dias: 150 })).toBe('2027-04-02');
    expect(sumarIntervalo('2026-12-15', { meses: 1, dias: 20 })).toBe('2027-02-04');
  });

  it('calcularPlazoRadicacion: sin plazo registrado en la entidad → null', () => {
    const incapacidad = { tipo: 'enfermedad_general', fechaInicio: '2026-11-03' };
    expect(calcularPlazoRadicacion(incapacidad, { plazoTranscripcion: null }, '2026-11-19')).toBeNull();
  });
});
