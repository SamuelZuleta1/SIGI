// Grupo `registro` contra Supabase (nube). Requisitos: proyecto vinculado y `npm run db:usuarios`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearClienteServidor } from '../../src/config/supabase.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearBaseDeDatos } from '../../src/persistence/base-de-datos.js';
import { formularioDeRegistro } from '../helpers/fabricas.js';

const servidor = crearClienteServidor();
const baseDeDatos = crearBaseDeDatos(servidor);
const control = crearControlIncapacidades({ baseDeDatos });

const correo = `prueba.registro.${Date.now()}@sigi.test`;
let receptor;
let auxiliar;
let entidad;

beforeAll(async () => {
  const { data: usuarios, error } = await servidor
    .from('usuario')
    .select('id, correo, rol')
    .in('correo', ['receptor1@sigi.test', 'auxiliar1@sigi.test']);
  if (error || usuarios.length !== 2) throw new Error('Faltan los usuarios de demostración: ejecute `npm run db:usuarios`');
  receptor = usuarios.find((u) => u.rol === 'receptor');
  auxiliar = usuarios.find((u) => u.rol === 'auxiliar');
  entidad = (await baseDeDatos.consultarEntidades()).find((e) => e.nombre === 'Nueva EPS');
});

afterAll(async () => {
  const { data: colaboradores } = await servidor.from('colaborador').select('id').eq('correo', correo);
  const ids = (colaboradores ?? []).map((c) => c.id);
  if (ids.length === 0) return;
  await servidor.from('incapacidad').delete().in('colaborador_id', ids);
  await servidor.from('colaborador').delete().in('id', ids);
});

const formulario = (cambios = {}) =>
  formularioDeRegistro({ correoColaborador: correo, entidad: String(entidad.id), ...cambios });

const leer = async (id) => {
  const { data, error } = await servidor.from('incapacidad').select('*, colaborador(nombre, correo)').eq('id', id).single();
  if (error) throw error;
  return data;
};

describe('HU-03 — registrar incapacidad o licencia (base de datos)', () => {
  it('consultarEntidades devuelve las EPS y ARL del seed, por nombre (DA-03)', async () => {
    const entidades = await baseDeDatos.consultarEntidades();
    expect(entidades.map((e) => e.nombre)).toEqual(
      ['ARL SURA', 'Asmet Salud', 'Nueva EPS', 'Salud Total', 'Sanitas', 'SOS', 'SURA EPS'].sort((a, b) => a.localeCompare(b)),
    );
  });

  it('HU-03.CA1 y HU-03.CA4 — guarda los 6 datos, asigna el identificador y queda sin estado', async () => {
    const { idIncapacidad } = await control.registrarIncapacidad(formulario(), receptor);
    expect(idIncapacidad).toBeGreaterThan(0);

    const fila = await leer(idIncapacidad);
    expect(fila).toMatchObject({
      tipo: 'enfermedad_general',
      entidad_id: entidad.id,
      fecha_inicio: '2026-11-03',
      dias_incapacidad: 5,
      fecha_recepcion: '2026-11-04',
      estado: null,
      creado_por: receptor.id,
      colaborador: { nombre: 'Ana María Gómez', correo },
    });
  });

  it('DA-03 — un segundo registro reutiliza al colaborador por su correo', async () => {
    const { idIncapacidad } = await control.registrarIncapacidad(
      formulario({ colaborador: 'Otro Nombre', tipo: 'licencia_maternidad', fechaInicio: '2026-12-01' }),
      auxiliar,
    );
    const fila = await leer(idIncapacidad);
    expect(fila.colaborador.nombre).toBe('Ana María Gómez');
    expect(fila.creado_por).toBe(auxiliar.id);

    const { count } = await servidor.from('colaborador').select('*', { head: true, count: 'exact' }).eq('correo', correo);
    expect(count).toBe(1);
  });

  it('HU-03.CA3 — la base de datos rechaza un tipo fuera de los 6', async () => {
    const error = await baseDeDatos
      .guardarIncapacidad(
        {
          colaborador: { nombre: 'Ana María Gómez', correo },
          tipo: 'vacaciones',
          entidad: entidad.id,
          fechaInicio: '2026-11-03',
          diasIncapacidad: 5,
          fechaRecepcion: '2026-11-04',
        },
        receptor.id,
      )
      .catch((e) => e);
    expect(error.code).toBe('23514');
  });
});
