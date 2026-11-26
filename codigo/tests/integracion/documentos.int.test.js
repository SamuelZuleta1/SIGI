// registrarDocumentos contra Supabase (nube) (tabla `documento` + bucket privado).
// Requisitos: proyecto vinculado y `npm run db:usuarios`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUCKET_DOCUMENTOS, crearClientePublico, crearClienteServidor } from '../../src/config/supabase.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearAlmacenDocumentos } from '../../src/persistence/almacen-documentos.js';
import { crearBaseDeDatos } from '../../src/persistence/base-de-datos.js';
import { crearPersistenciaRegistro } from '../../src/persistence/registro.persistence.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { documentoDePrueba, formularioDeRegistro, PDF, PNG, diasDistintos } from '../helpers/fabricas.js';

const diasDelCaso = diasDistintos(); // HU-03: sin duplicados entre las pruebas del archivo

const servidor = crearClienteServidor();
const baseDeDatos = crearBaseDeDatos(servidor);
const { correo, enviados } = crearCorreoFalso();
const control = crearControlIncapacidades({ baseDeDatos, correo });
const bucket = servidor.storage.from(BUCKET_DOCUMENTOS);

const correoColaborador = `prueba.documentos.${Date.now()}@sigi.test`;
const ids = [];
let receptor;
let auxiliar;
let entidad;

const nueva = async () => {
  const { idIncapacidad } = await control.registrarIncapacidad(
    formularioDeRegistro({ diasIncapacidad: diasDelCaso(), correoColaborador, entidad: String(entidad.id) }),
    receptor,
  );
  ids.push(idIncapacidad);
  return idIncapacidad;
};

const filas = async (id) => {
  const { data, error } = await servidor.from('documento').select('tipo, archivo, creado_por').eq('incapacidad_id', id).order('id');
  if (error) throw error;
  return data;
};

const archivosDe = async (id) => (await bucket.list(`incapacidades/${id}`)).data ?? [];

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
  for (const id of ids) {
    const archivos = await archivosDe(id);
    if (archivos.length) await bucket.remove(archivos.map((a) => `incapacidades/${id}/${a.name}`));
  }
  if (ids.length) await servidor.from('incapacidad').delete().in('id', ids); // borra sus documentos en cascada
  await servidor.from('colaborador').delete().eq('correo', correoColaborador);
});

describe('HU-04 — registrar la documentación recibida (base de datos y Storage)', () => {
  it('HU-04.CA1 — guarda tipo y archivo, sube al bucket privado y avisa al auxiliar', async () => {
    const id = await nueva();
    const resultado = await control.registrarDocumentos(
      id,
      [documentoDePrueba(), documentoDePrueba({ tipo: 'epicrisis', contenido: PNG })],
      receptor,
    );
    expect(resultado).toMatchObject({ cantidad: 2, originalPendiente: false, avisoEnviado: true });

    const guardados = await filas(id);
    expect(guardados.map((d) => d.tipo)).toEqual(['soporte_incapacidad', 'epicrisis']);
    expect(guardados.every((d) => d.creado_por === receptor.id)).toBe(true);
    expect(guardados[0].archivo).toMatch(new RegExp(`^incapacidades/${id}/soporte_incapacidad-[0-9a-f-]{36}\\.pdf$`));
    expect(guardados[1].archivo).toMatch(/\.png$/);

    const descarga = await bucket.download(guardados[0].archivo);
    expect(descarga.error).toBeNull();
    expect(Buffer.from(await descarga.data.arrayBuffer()).equals(PDF)).toBe(true);
    expect(descarga.data.type).toBe('application/pdf');

    expect(enviados.at(-1).subject).toContain(`incapacidad n.º ${id}`);
    const { data } = await servidor.from('incapacidad').select('original_pendiente').eq('id', id).single();
    expect(data.original_pendiente).toBe(false);
  });

  it('HU-02.CA3 — el archivo subido no se puede descargar sin la clave de servidor', async () => {
    const [{ archivo }] = await filas(ids[0]);
    const publico = crearClientePublico();
    expect((await publico.storage.from(BUCKET_DOCUMENTOS).download(archivo)).error).not.toBeNull();
    expect((await fetch(publico.storage.from(BUCKET_DOCUMENTOS).getPublicUrl(archivo).data.publicUrl)).ok).toBe(false);
  });

  it('HU-04.CA2 — por correo (auxiliar): guarda y marca el original en físico como pendiente, sin aviso', async () => {
    const id = await nueva();
    const antes = enviados.length;
    const resultado = await control.registrarDocumentos(id, [documentoDePrueba()], auxiliar);
    expect(resultado).toMatchObject({ cantidad: 1, originalPendiente: true, avisoEnviado: false });
    expect(await filas(id)).toHaveLength(1);
    expect(enviados).toHaveLength(antes);

    const { data } = await servidor.from('incapacidad').select('original_pendiente').eq('id', id).single();
    expect(data.original_pendiente).toBe(true);
    expect((await control.obtenerIncapacidad(id)).originalPendiente).toBe(true);
  });

  it('HU-04 — cuando el original llega en físico a recepción deja de estar pendiente', async () => {
    const id = await nueva();
    await control.registrarDocumentos(id, [documentoDePrueba()], auxiliar);
    await control.registrarDocumentos(id, [documentoDePrueba()], receptor);
    const { data } = await servidor.from('incapacidad').select('original_pendiente').eq('id', id).single();
    expect(data.original_pendiente).toBe(false);
  });

  it('consultarIncapacidad trae los datos que la identifican y null si no existe', async () => {
    const { documentos, ...datos } = await baseDeDatos.consultarIncapacidad(ids[0]);
    expect(documentos.length).toBeGreaterThan(0); // los que registró la preparación de la prueba
    expect(datos).toEqual({
      idIncapacidad: ids[0],
      colaborador: 'Ana María Gómez',
      correoColaborador,
      tipo: 'enfermedad_general',
      entidad: 'Nueva EPS',
      fechaInicio: '2026-11-03',
      diasIncapacidad: 5,
      originalPendiente: false,
      archivoPreparado: false,
      epicrisisEliminada: false,
    });
    expect(await baseDeDatos.consultarIncapacidad(2 ** 40)).toBeNull();
  });

  it('consultarIncapacidad lista lo ya registrado, en orden y con su fecha, sin traer el archivo', async () => {
    const id = await nueva();
    await baseDeDatos.guardarDocumentos(
      id,
      [
        { tipo: 'epicrisis', contenido: PDF, tipoMime: 'application/pdf' },
        { tipo: 'furips', contenido: PDF, tipoMime: 'application/pdf' },
      ],
      receptor.id,
    );
    const { documentos } = await baseDeDatos.consultarIncapacidad(id);
    expect(documentos.map((d) => d.tipo)).toEqual(['epicrisis', 'furips']);
    expect(documentos[0]).toEqual({ idDocumento: expect.any(Number), tipo: 'epicrisis', creadoEn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) });
    expect(documentos[0].idDocumento).toBeLessThan(documentos[1].idDocumento);
  });

  it('DA-06 — la base de datos rechaza un tipo de documento fuera de los 7 y no deja archivos sueltos', async () => {
    const id = await nueva();
    const error = await baseDeDatos
      .guardarDocumentos(id, [{ tipo: 'cedula', contenido: PDF, tipoMime: 'application/pdf' }], receptor.id)
      .catch((e) => e);
    expect(error.code).toBe('23514');
    expect(await filas(id)).toHaveLength(0);
    expect(await archivosDe(id)).toHaveLength(0);
  });

  it('HU-04.CA2 — si un documento no se puede guardar, no queda ninguno ni la marca de original pendiente', async () => {
    const id = await nueva();
    const error = await baseDeDatos
      .guardarDocumentos(
        id,
        [
          { tipo: 'soporte_incapacidad', contenido: PDF, tipoMime: 'application/pdf' },
          { tipo: 'cedula', contenido: PDF, tipoMime: 'application/pdf' },
        ],
        auxiliar.id,
        { originalPendiente: true },
      )
      .catch((e) => e);
    expect(error.code).toBe('23514');
    expect(await filas(id)).toHaveLength(0);
    expect(await archivosDe(id)).toHaveLength(0);
    const { data } = await servidor.from('incapacidad').select('original_pendiente').eq('id', id).single();
    expect(data.original_pendiente).toBe(false);
  });

  it('las funciones de registro no se pueden llamar con la clave pública', async () => {
    const publico = crearClientePublico();
    const { error } = await publico.rpc('registrar_documentos', {
      p_incapacidad_id: ids[0],
      p_documentos: [{ tipo: 'soporte_incapacidad', archivo: 'x' }],
      p_original_pendiente: true,
      p_creado_por: auxiliar.id,
    });
    expect(error).not.toBeNull();
    expect(await filas(ids[0])).not.toContainEqual(expect.objectContaining({ archivo: 'x' }));
  });

  it('si una subida falla, se borran las anteriores y no se guarda ninguna fila', async () => {
    const id = await nueva();
    const real = crearAlmacenDocumentos(servidor);
    let subidas = 0;
    const almacen = {
      eliminar: real.eliminar,
      guardar: async (...args) => {
        subidas += 1;
        if (subidas === 2) throw new Error('Storage no disponible');
        return real.guardar(...args);
      },
    };
    const persistencia = crearPersistenciaRegistro(servidor, almacen);
    await expect(
      persistencia.guardarDocumentos(
        id,
        [
          { tipo: 'soporte_incapacidad', contenido: PDF, tipoMime: 'application/pdf' },
          { tipo: 'epicrisis', contenido: PDF, tipoMime: 'application/pdf' },
        ],
        receptor.id,
      ),
    ).rejects.toThrow('Storage no disponible');
    expect(await filas(id)).toHaveLength(0);
    expect(await archivosDe(id)).toHaveLength(0);
  });
});
