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

  it('DA-03 — un segundo registro reutiliza al colaborador por su correo (con otro nombre, confirmándolo: decisión 1A)', async () => {
    const { idIncapacidad } = await control.registrarIncapacidad(
      formulario({ colaborador: 'Otro Nombre', usarNombreGuardado: 'si', tipo: 'licencia_maternidad', fechaInicio: '2026-11-10' }),
      auxiliar,
    );
    const fila = await leer(idIncapacidad);
    expect(fila.colaborador.nombre).toBe('Ana María Gómez');
    expect(fila.creado_por).toBe(auxiliar.id);

    const { count } = await servidor.from('colaborador').select('*', { head: true, count: 'exact' }).eq('correo', correo);
    expect(count).toBe(1);
  });

  it('HU-03 — si la incapacidad no se puede guardar, tampoco queda el colaborador nuevo', async () => {
    const nuevo = `prueba.atomico.${Date.now()}@sigi.test`;
    const error = await baseDeDatos
      .guardarIncapacidad(
        {
          colaborador: { nombre: 'Colaborador Sin Incapacidad', correo: nuevo },
          tipo: 'enfermedad_general',
          entidad: entidad.id,
          fechaInicio: '2026-11-03',
          diasIncapacidad: 0, // viola dias_incapacidad > 0 después de crear el colaborador
          fechaRecepcion: '2026-11-04',
        },
        receptor.id,
      )
      .catch((e) => e);
    expect(error.code).toBe('23514');
    const { count } = await servidor.from('colaborador').select('*', { head: true, count: 'exact' }).eq('correo', nuevo);
    expect(count).toBe(0);
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

describe('HU-03 y HU-12 (auditoría) — la base vuelve a comprobar las reglas del registro', () => {
  const guardar = (cambios) =>
    baseDeDatos
      .guardarIncapacidad(
        {
          colaborador: { nombre: 'Ana María Gómez', correo },
          tipo: 'enfermedad_general',
          entidad: entidad.id,
          fechaInicio: '2026-11-03',
          diasIncapacidad: 5,
          fechaRecepcion: '2026-11-04',
          nombreConfirmado: true,
          ...cambios,
        },
        receptor.id,
      )
      .then((id) => ({ id }))
      .catch((e) => ({ codigo: e.code }));
  let arl;
  beforeAll(async () => {
    arl = (await baseDeDatos.consultarEntidades()).find((e) => e.tipo === 'ARL');
  });

  it('SG022 — recepción futura, anterior al inicio o inicio de hace más de 3 años', async () => {
    expect(await guardar({ fechaRecepcion: '2099-01-01', diasIncapacidad: 41 })).toEqual({ codigo: 'SG022' });
    expect(await guardar({ fechaInicio: '2026-11-05', fechaRecepcion: '2026-11-04', diasIncapacidad: 41 })).toEqual({ codigo: 'SG022' });
    expect(await guardar({ fechaInicio: '2020-01-01', fechaRecepcion: '2020-01-02', diasIncapacidad: 41 })).toEqual({ codigo: 'SG022' });
  });

  it('SG021 — el tipo no corresponde a la entidad (lo laboral a la ARL, lo demás a la EPS)', async () => {
    expect(await guardar({ tipo: 'accidente_laboral', diasIncapacidad: 42 })).toEqual({ codigo: 'SG021' });
    expect(await guardar({ entidad: arl.id, diasIncapacidad: 42 })).toEqual({ codigo: 'SG021' });
    expect(await guardar({ tipo: 'enfermedad_laboral', entidad: arl.id, diasIncapacidad: 42 })).toHaveProperty('id');
  });

  it('SG020 — el correo ya es de otro nombre y no se confirmó; confirmado, se usa el guardado', async () => {
    expect(await guardar({ colaborador: { nombre: 'Nombre Distinto', correo }, nombreConfirmado: false, diasIncapacidad: 43 })).toEqual({ codigo: 'SG020' });
    // Mayúsculas y espacios de más no son otro nombre.
    expect(await guardar({ colaborador: { nombre: '  ana  maría GÓMEZ ', correo }, nombreConfirmado: false, diasIncapacidad: 44 })).toHaveProperty('id');
  });

  it('23505 — el mismo colaborador, tipo, inicio y días no se guarda dos veces', async () => {
    expect(await guardar({ diasIncapacidad: 45 })).toHaveProperty('id');
    expect(await guardar({ diasIncapacidad: 45, fechaRecepcion: '2026-11-05' })).toEqual({ codigo: '23505' });
  });

  it('SG023 — fecha de nacimiento: obligatoria y en su ventana en las licencias, no futura, y solo en ellas', async () => {
    const paternidad = { tipo: 'licencia_paternidad', diasIncapacidad: 14 };
    expect(await guardar({ ...paternidad })).toEqual({ codigo: 'SG023' }); // sin fecha
    expect(await guardar({ ...paternidad, fechaNacimiento: '2026-09-01' })).toEqual({ codigo: 'SG023' }); // más de 30 días
    expect(await guardar({ ...paternidad, fechaNacimiento: '2099-01-01' })).toEqual({ codigo: 'SG023' }); // futura
    expect(await guardar({ tipo: 'licencia_maternidad', diasIncapacidad: 14, fechaNacimiento: '2026-11-02' })).toEqual({ codigo: 'SG023' }); // después del nacimiento
    expect(await guardar({ diasIncapacidad: 46, fechaNacimiento: '2026-11-01' })).toEqual({ codigo: 'SG023' }); // no es licencia
    const { id } = await guardar({ ...paternidad, fechaNacimiento: '2026-10-04' }); // inicio = nacimiento + 30
    expect((await leer(id)).fecha_nacimiento).toBe('2026-10-04');
  });

  it('las restricciones de la tabla protegen también lo que no pasa por la función', async () => {
    const directo = (fila) =>
      servidor.from('incapacidad').insert({
        colaborador_id: null, entidad_id: entidad.id, tipo: 'enfermedad_general', fecha_inicio: '2026-11-03', dias_incapacidad: 47,
        fecha_recepcion: '2026-11-04', creado_por: receptor.id, ...fila,
      });
    const { data: c } = await servidor.from('colaborador').select('id').eq('correo', correo).single();
    expect((await directo({ colaborador_id: c.id, fecha_recepcion: '2026-11-02' })).error?.message).toMatch(/incapacidad_recepcion_desde_inicio/);
    expect((await directo({ colaborador_id: c.id, tipo: 'licencia_paternidad' })).error?.message).toMatch(/incapacidad_fecha_nacimiento_licencia/);
  });
});
