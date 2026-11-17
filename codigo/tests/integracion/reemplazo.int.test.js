// Grupo `reemplazo` contra Supabase local. Requisitos: `npm run db:start` y `npm run db:usuarios`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearClienteServidor } from '../../src/config/supabase.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearBaseDeDatos } from '../../src/persistence/base-de-datos.js';
import { formularioDeRegistro } from '../helpers/fabricas.js';

const servidor = crearClienteServidor();
const baseDeDatos = crearBaseDeDatos(servidor);
const control = crearControlIncapacidades({ baseDeDatos });

const correoColaborador = `prueba.reemplazo.${Date.now()}@sigi.test`;
let lider;
let idIncapacidad;

const filas = async () => {
  const { data, error } = await servidor.from('reemplazo').select('reemplazo, creado_por').eq('incapacidad_id', idIncapacidad);
  if (error) throw error;
  return data;
};

beforeAll(async () => {
  const { data: usuarios, error } = await servidor
    .from('usuario')
    .select('id, correo, rol')
    .in('correo', ['receptor1@sigi.test', 'lider1@sigi.test']);
  if (error || usuarios.length !== 2) throw new Error('Faltan los usuarios de demostración: ejecute `npm run db:usuarios`');
  lider = usuarios.find((u) => u.rol === 'lider');
  const entidad = (await baseDeDatos.consultarEntidades()).find((e) => e.nombre === 'Nueva EPS');
  ({ idIncapacidad } = await control.registrarIncapacidad(
    formularioDeRegistro({ correoColaborador, entidad: String(entidad.id) }),
    usuarios.find((u) => u.rol === 'receptor'),
  ));
});

afterAll(async () => {
  if (idIncapacidad) await servidor.from('incapacidad').delete().eq('id', idIncapacidad); // borra su reemplazo en cascada
  await servidor.from('colaborador').delete().eq('correo', correoColaborador);
});

describe('HU-05 — registrar el reemplazo del colaborador (base de datos)', () => {
  it('sin registrar, la incapacidad no tiene reemplazo', async () => {
    expect(await baseDeDatos.consultarReemplazo(idIncapacidad)).toBeNull();
  });

  it('HU-05.CA1 — guarda el reemplazo asociado a la incapacidad, con quien lo registró (DA-23)', async () => {
    await control.registrarReemplazo(idIncapacidad, 'Carlos Ruiz', lider);
    expect(await filas()).toEqual([{ reemplazo: 'Carlos Ruiz', creado_por: lider.id }]);
    expect(await baseDeDatos.consultarReemplazo(idIncapacidad)).toBe('Carlos Ruiz');
  });

  it('HU-05.CA2 — un segundo registro sustituye al anterior: queda una sola fila (DA-22)', async () => {
    await control.registrarReemplazo(idIncapacidad, 'Marta Lopera', lider);
    expect(await filas()).toEqual([{ reemplazo: 'Marta Lopera', creado_por: lider.id }]);
  });

  it('HU-05.CA2 — el índice único rechaza una segunda fila para la misma incapacidad', async () => {
    const { error } = await servidor
      .from('reemplazo')
      .insert({ incapacidad_id: idIncapacidad, reemplazo: 'Otra persona', creado_por: lider.id });
    expect(error.code).toBe('23505');
    expect(await filas()).toHaveLength(1);
  });

  it('la base de datos rechaza un reemplazo en blanco', async () => {
    const error = await baseDeDatos.guardarReemplazo(idIncapacidad, '   ', lider.id).catch((e) => e);
    expect(error.code).toBe('23514');
  });
});
