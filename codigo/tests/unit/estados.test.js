// HU-11 — consultar el estado de las incapacidades (DS-05, CU-08): Control con persistencia falsa.
// Filtros (DA-20): estado (incluido «sin valor» = registrada), entidad, colaborador y rango de fechas de inicio.
import { beforeEach, describe, expect, it } from 'vitest';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { LIMITE_RESULTADOS, MAXIMO_COLABORADORES_COINCIDENTES, normalizarTexto } from '../../src/controllers/estados.controller.js';
import { ErrorDeValidacion } from '../../src/controllers/error-de-validacion.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { formularioDeRegistro } from '../helpers/fabricas.js';
import { USUARIOS } from '../helpers/sesion-falsa.js';

let baseDeDatos;
let control;

const registrar = async (cambios, estado = null) => {
  const { idIncapacidad } = await control.registrarIncapacidad(formularioDeRegistro(cambios), USUARIOS.receptor);
  baseDeDatos.incapacidades.find((i) => i.idIncapacidad === idIncapacidad).estado = estado;
  return idIncapacidad;
};

// 1 Ana (Nueva EPS, 3 nov, registrada) · 2 Ana (Sanitas, 20 oct, transcrita) · 3 Jorge (Nueva EPS, 1 sep, rechazada)
// 4 Jorge (Salud Total, 10 nov, cobrada) · 5 Luisa (ARL SURA, 15 jul, pagada)
beforeEach(async () => {
  baseDeDatos = crearBaseDeDatosFalsa();
  control = crearControlIncapacidades({ baseDeDatos, correo: crearCorreoFalso().correo, hoy: () => '2026-11-19' });
  await registrar({ entidad: '2', fechaInicio: '2026-11-03' });
  await registrar({ entidad: '3', fechaInicio: '2026-10-20' }, 'transcrita');
  const jorge = { colaborador: 'Jorge Iván Cardona', correoColaborador: 'jorge.cardona@sigi.test' };
  await registrar({ ...jorge, entidad: '2', fechaInicio: '2026-09-01' }, 'rechazada');
  await registrar({ ...jorge, entidad: '4', fechaInicio: '2026-11-10' }, 'cobrada');
  await registrar({ colaborador: 'Luisa Ríos', correoColaborador: 'luisa.rios@sigi.test', entidad: '1', fechaInicio: '2026-07-15', tipo: 'accidente_laboral' }, 'pagada');
});

const ids = (resultado) => resultado.incapacidades.map((i) => i.idIncapacidad);

describe('HU-11.CA1 — lista las que cumplen los filtros con su estado', () => {
  it('HU-11.CA1 — sin filtros: todas, de la más reciente a la más antigua por fecha de inicio', async () => {
    const resultado = await control.obtenerEstados({});
    expect(ids(resultado)).toEqual([4, 1, 2, 3, 5]);
    expect(resultado.total).toBe(5);
    expect(resultado.limitado).toBe(false);
    expect(resultado.incapacidades[0]).toEqual({
      idIncapacidad: 4,
      colaborador: 'Jorge Iván Cardona',
      tipo: 'enfermedad_general',
      entidad: 'Salud Total',
      fechaInicio: '2026-11-10',
      diasIncapacidad: 5,
      estado: 'cobrada',
    });
  });

  it.each([
    ['transcrita', [2]],
    ['cobrada', [4]],
    ['rechazada', [3]],
    ['pagada', [5]],
  ])('HU-11.CA1 — filtra por el estado %s', async (estado, esperados) => {
    const resultado = await control.obtenerEstados({ estado });
    expect(ids(resultado)).toEqual(esperados);
    expect(resultado.incapacidades.every((i) => i.estado === estado)).toBe(true);
  });

  it('DA-20 — «registrada» trae las que aún no tienen estado (sin valor)', async () => {
    const resultado = await control.obtenerEstados({ estado: 'registrada' });
    expect(ids(resultado)).toEqual([1]);
    expect(resultado.incapacidades[0].estado).toBeNull();
  });

  it('DA-20 — filtra por entidad', async () => {
    expect(ids(await control.obtenerEstados({ entidad: '2' }))).toEqual([1, 3]);
  });

  it('DA-20 — filtra por colaborador con parte del nombre, sin importar tildes ni mayúsculas', async () => {
    expect(ids(await control.obtenerEstados({ colaborador: 'jorge ivan' }))).toEqual([4, 3]);
    expect(ids(await control.obtenerEstados({ colaborador: '  RÍOS ' }))).toEqual([5]);
  });

  it('DA-20 — colaborador que no existe: lista vacía y conteos en cero', async () => {
    const resultado = await control.obtenerEstados({ colaborador: 'Pedro' });
    expect(resultado.incapacidades).toEqual([]);
    expect(resultado.conteos).toEqual({ registrada: 0, transcrita: 0, cobrada: 0, rechazada: 0, pagada: 0 });
  });

  it('DA-20 — rango de fechas de inicio, con los dos extremos incluidos', async () => {
    expect(ids(await control.obtenerEstados({ desde: '2026-10-20', hasta: '2026-11-03' }))).toEqual([1, 2]);
    expect(ids(await control.obtenerEstados({ desde: '2026-11-04' }))).toEqual([4]);
    expect(ids(await control.obtenerEstados({ hasta: '2026-09-01' }))).toEqual([3, 5]);
  });

  it('DA-20 — combina los filtros', async () => {
    const resultado = await control.obtenerEstados({ colaborador: 'jorge', entidad: '2', estado: 'rechazada', desde: '2026-08-01' });
    expect(ids(resultado)).toEqual([3]);
  });

  it('HU-11.CA1 — cuenta cuántas hay en cada estado con los demás filtros (sin el de estado)', async () => {
    const resultado = await control.obtenerEstados({ estado: 'cobrada', entidad: '2' });
    expect(ids(resultado)).toEqual([]);
    expect(resultado.conteos).toEqual({ registrada: 1, transcrita: 0, cobrada: 0, rechazada: 1, pagada: 0 });
  });

  it('HU-11.CA1 — muestra como máximo LIMITE_RESULTADOS y avisa que hay más', async () => {
    const plantilla = baseDeDatos.incapacidades[0];
    for (let n = 0; n < LIMITE_RESULTADOS; n += 1) {
      baseDeDatos.incapacidades.push({ ...plantilla, idIncapacidad: 100 + n });
    }
    const resultado = await control.obtenerEstados({});
    expect(resultado.incapacidades).toHaveLength(LIMITE_RESULTADOS);
    expect(resultado.total).toBe(LIMITE_RESULTADOS + 5);
    expect(resultado.limitado).toBe(true);
  });

  it('normalizarTexto — quita tildes, mayúsculas y espacios repetidos', () => {
    expect(normalizarTexto('  Ana   MARÍA Gómez ')).toBe('ana maria gomez');
  });
});

describe('HU-11 — filtros no válidos', () => {
  const errores = async (consulta) => {
    try {
      await control.obtenerEstados(consulta);
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorDeValidacion);
      return error.errores;
    }
    throw new Error('Se esperaba un ErrorDeValidacion');
  };

  it('estado fuera de la lista', async () => {
    expect(await errores({ estado: 'archivada' })).toEqual({ estado: 'Escoja un estado de la lista.' });
  });

  it('entidad que no es un identificador', async () => {
    expect(await errores({ entidad: '2 or 1=1' })).toEqual({ entidad: 'Escoja una entidad de la lista.' });
  });

  it('fechas que no existen o con otro formato', async () => {
    expect(await errores({ desde: '2026-02-30', hasta: '19/11/2026' })).toEqual({
      desde: 'Escriba una fecha válida (día, mes y año).',
      hasta: 'Escriba una fecha válida (día, mes y año).',
    });
  });

  it('año 0000: Postgres no lo admite, se rechaza como fecha no válida', async () => {
    expect(await errores({ desde: '0000-01-01' })).toEqual({ desde: 'Escriba una fecha válida (día, mes y año).' });
    expect(ids(await control.obtenerEstados({ desde: '0001-01-01' }))).toEqual([4, 1, 2, 3, 5]);
  });

  it('nombre que coincide con demasiados colaboradores: pide escribir más del nombre', async () => {
    for (let n = 0; n < MAXIMO_COLABORADORES_COINCIDENTES; n += 1) {
      baseDeDatos.colaboradores.push({ id: 1000 + n, nombre: `Ana Prueba ${n}`, correo: `ana${n}@sigi.test` });
    }
    expect(await errores({ colaborador: 'ana' })).toEqual({
      colaborador: 'Hay demasiados colaboradores con ese texto: escriba más del nombre.',
    });
    expect(ids(await control.obtenerEstados({ colaborador: 'ana maria' }))).toEqual([1, 2]);
  });

  it('«hasta» anterior a «desde»', async () => {
    expect(await errores({ desde: '2026-11-10', hasta: '2026-11-01' })).toEqual({
      hasta: 'La fecha «hasta» no puede ser anterior a «desde».',
    });
  });

  it('nombre del colaborador demasiado largo', async () => {
    expect(Object.keys(await errores({ colaborador: 'a'.repeat(101) }))).toEqual(['colaborador']);
  });

  it('un parámetro repetido en la URL se toma una sola vez', async () => {
    expect(ids(await control.obtenerEstados({ estado: ['pagada', 'cobrada'] }))).toEqual([5]);
  });
});

describe('HU-11.CA2 — la consulta no modifica ningún dato', () => {
  it('HU-11.CA2 — después de consultar con y sin filtros, los datos quedan iguales', async () => {
    const antes = structuredClone({ incapacidades: baseDeDatos.incapacidades, colaboradores: baseDeDatos.colaboradores });
    await control.obtenerEstados({});
    await control.obtenerEstados({ estado: 'registrada', colaborador: 'ana', entidad: '2', desde: '2026-01-01', hasta: '2026-12-31' });
    await control.obtenerEstados({ estado: 'nada' }).catch(() => {});
    expect({ incapacidades: baseDeDatos.incapacidades, colaboradores: baseDeDatos.colaboradores }).toEqual(antes);
  });
});
