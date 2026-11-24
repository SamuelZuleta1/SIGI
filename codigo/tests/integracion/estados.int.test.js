// HU-11 contra Supabase (nube): consultarIncapacidades y contarPorEstado con los filtros de DA-20
// (estado null = registrada, entidad, colaborador por id, rango de fechas). Solo lectura.
// Requisitos: proyecto vinculado, migraciones aplicadas y `npm run db:usuarios`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearClienteServidor } from '../../src/config/supabase.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearBaseDeDatos } from '../../src/persistence/base-de-datos.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { formularioDeRegistro } from '../helpers/fabricas.js';

const servidor = crearClienteServidor();
const baseDeDatos = crearBaseDeDatos(servidor);
const control = crearControlIncapacidades({ baseDeDatos, correo: crearCorreoFalso().correo, hoy: () => '2026-11-19' });

// Un colaborador con nombre único: los filtros se acotan a él para no depender de otros datos de la nube.
const marca = Date.now();
const nombre = `Prueba Estados ${marca} Muñoz`;
const correoColaborador = `prueba.estados.${marca}@sigi.test`;
const ids = [];
let receptor;
let entidades;

beforeAll(async () => {
  const { data, error } = await servidor.from('usuario').select('id, correo, rol').eq('correo', 'receptor1@sigi.test').maybeSingle();
  if (error || !data) throw new Error('Faltan los usuarios de demostración: ejecute `npm run db:usuarios`');
  receptor = data;
  entidades = await baseDeDatos.consultarEntidades();
  const entidad = (n) => String(entidades.find((e) => e.nombre === n).id);
  for (const [nombreEntidad, fechaInicio, estado] of [
    ['Nueva EPS', '2026-11-03', null],
    ['Sanitas', '2026-10-20', 'transcrita'],
    ['Nueva EPS', '2026-09-01', 'rechazada'],
  ]) {
    const { idIncapacidad } = await control.registrarIncapacidad(
      formularioDeRegistro({ colaborador: nombre, correoColaborador, entidad: entidad(nombreEntidad), fechaInicio }),
      receptor,
    );
    ids.push(idIncapacidad);
    if (estado) {
      // Una rechazada siempre lleva su causal y su fecha (DA-39).
      const cambio = estado === 'rechazada' ? { estado, causal_rechazo: 'Soporte ilegible', fecha_rechazo: '2026-09-15' } : { estado };
      const { error: e } = await servidor.from('incapacidad').update(cambio).eq('id', idIncapacidad);
      if (e) throw e;
    }
  }
});

afterAll(async () => {
  if (ids.length) await servidor.from('incapacidad').delete().in('id', ids);
  await servidor.from('colaborador').delete().eq('correo', correoColaborador);
});

const idsDe = (r) => r.incapacidades.map((i) => i.idIncapacidad);

describe('HU-11 — consultar estados (base de datos)', () => {
  it('HU-11.CA1 — por colaborador (sin tildes): las tres, de la más reciente a la más antigua, con su estado', async () => {
    const r = await control.obtenerEstados({ colaborador: `estados ${marca} munoz` });
    expect(idsDe(r)).toEqual(ids);
    expect(r.total).toBe(3);
    expect(r.incapacidades[0]).toEqual({
      idIncapacidad: ids[0],
      colaborador: nombre,
      tipo: 'enfermedad_general',
      entidad: 'Nueva EPS',
      fechaInicio: '2026-11-03',
      diasIncapacidad: 5,
      estado: null,
      enviadaAGestionDocumental: false,
    });
    expect(r.conteos).toEqual({ registrada: 1, transcrita: 1, cobrada: 0, rechazada: 1, pagada: 0 });
  });

  it('DA-20 — «registrada» filtra estado null; un estado con valor filtra por igualdad', async () => {
    expect(idsDe(await control.obtenerEstados({ colaborador: nombre, estado: 'registrada' }))).toEqual([ids[0]]);
    expect(idsDe(await control.obtenerEstados({ colaborador: nombre, estado: 'rechazada' }))).toEqual([ids[2]]);
  });

  it('DA-20 — entidad y rango de fechas de inicio (extremos incluidos)', async () => {
    const nueva = String(entidades.find((e) => e.nombre === 'Nueva EPS').id);
    expect(idsDe(await control.obtenerEstados({ colaborador: nombre, entidad: nueva }))).toEqual([ids[0], ids[2]]);
    const r = await control.obtenerEstados({ colaborador: nombre, desde: '2026-10-20', hasta: '2026-11-03' });
    expect(idsDe(r)).toEqual([ids[0], ids[1]]);
    expect(r.conteos).toEqual({ registrada: 1, transcrita: 1, cobrada: 0, rechazada: 0, pagada: 0 });
  });

  it('HU-11 — sin filtros responde con la cuenta total aunque haya más que el límite', async () => {
    const r = await control.obtenerEstados({});
    expect(r.total).toBeGreaterThanOrEqual(3);
    expect(r.incapacidades.length).toBe(Math.min(r.total, 200));
    expect(r.limitado).toBe(r.total > 200);
  });

  it('HU-11.CA2 — consultar no cambia las filas', async () => {
    const leer = async () => (await servidor.from('incapacidad').select('*').in('id', ids).order('id')).data;
    const antes = await leer();
    await control.obtenerEstados({ colaborador: nombre, estado: 'transcrita' });
    expect(await leer()).toEqual(antes);
  });
});
