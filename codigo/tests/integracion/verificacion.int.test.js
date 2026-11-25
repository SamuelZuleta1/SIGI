// Grupo `verificacion` contra Supabase (nube): obtenerExpediente, archivarDigital y «ver documento» desde el bucket.
// Requisitos: proyecto vinculado y `npm run db:usuarios`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUCKET_DOCUMENTOS, crearClienteServidor } from '../../src/config/supabase.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearBaseDeDatos } from '../../src/persistence/base-de-datos.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { documentoDePrueba, formularioDeRegistro, PDF, PNG } from '../helpers/fabricas.js';

const servidor = crearClienteServidor();
const baseDeDatos = crearBaseDeDatos(servidor);
const control = crearControlIncapacidades({ baseDeDatos, correo: crearCorreoFalso().correo });
const bucket = servidor.storage.from(BUCKET_DOCUMENTOS);

const correoColaborador = `prueba.verificacion.${Date.now()}@sigi.test`;
const ids = [];
let receptor;
let entidad;

const nueva = async (cambios) => {
  const { idIncapacidad } = await control.registrarIncapacidad(
    formularioDeRegistro({ correoColaborador, entidad: String(entidad.id), ...cambios }),
    receptor,
  );
  ids.push(idIncapacidad);
  return idIncapacidad;
};

const banderas = async (id) => {
  const { data, error } = await servidor.from('incapacidad').select('documentacion_completa, archivado_digital').eq('id', id).single();
  if (error) throw error;
  return data;
};

beforeAll(async () => {
  const { data, error } = await servidor.from('usuario').select('id, correo, rol').eq('correo', 'receptor1@sigi.test').maybeSingle();
  if (error || !data) throw new Error('Faltan los usuarios de demostración: ejecute `npm run db:usuarios`');
  receptor = data;
  entidad = (await baseDeDatos.consultarEntidades()).find((e) => e.nombre === 'Nueva EPS');
});

afterAll(async () => {
  for (const id of ids) {
    const { data: archivos } = await bucket.list(`incapacidades/${id}`);
    if (archivos?.length) await bucket.remove(archivos.map((a) => `incapacidades/${id}/${a.name}`));
  }
  if (ids.length) await servidor.from('incapacidad').delete().in('id', ids);
  await servidor.from('colaborador').delete().eq('correo', correoColaborador);
});

describe('HU-06 — verificar la documentación (base de datos y Storage)', () => {
  it('HU-06.CA1 — obtenerExpediente trae la incapacidad y sus documentos en orden, sin escribir', async () => {
    const id = await nueva({ tipo: 'accidente_transito', diasIncapacidad: '4' });
    await control.registrarDocumentos(id, [documentoDePrueba(), documentoDePrueba({ tipo: 'furips', contenido: PNG })], receptor);
    const expediente = await baseDeDatos.obtenerExpediente(id);
    expect(expediente).toMatchObject({
      idIncapacidad: id,
      tipo: 'accidente_transito',
      entidad: 'Nueva EPS',
      diasIncapacidad: 4,
      originalPendiente: false,
      documentacionCompleta: null,
      archivadoDigital: false,
    });
    expect(expediente.documentos.map((d) => d.tipo)).toEqual(['soporte_incapacidad', 'furips']);

    const { resultado } = await control.verificarDocumentacion(id);
    expect(resultado.faltantes).toEqual(['epicrisis']);
    expect(await banderas(id)).toEqual({ documentacion_completa: null, archivado_digital: false });
  });

  it('HU-06.CA3 — con faltantes, registrarVerificacion no cambia la base de datos', async () => {
    const id = await nueva({ tipo: 'enfermedad_general', diasIncapacidad: '5' });
    await control.registrarDocumentos(id, [documentoDePrueba()], receptor);
    await expect(control.registrarVerificacion(id)).rejects.toThrow('Datos no válidos');
    expect(await banderas(id)).toEqual({ documentacion_completa: null, archivado_digital: false });
  });

  it('HU-06.CA2 — completa: archivarDigital marca documentación completa y archivada', async () => {
    const id = await nueva({ tipo: 'enfermedad_general', diasIncapacidad: '6' }); // 6: no es duplicado de la anterior (HU-03)
    await control.registrarDocumentos(id, [documentoDePrueba()], receptor);
    await control.registrarVerificacion(id, { epsTranscribio: true });
    expect(await banderas(id)).toEqual({ documentacion_completa: true, archivado_digital: true });
  });

  it('archivarDigital de una incapacidad inexistente falla', async () => {
    await expect(baseDeDatos.archivarDigital(9_000_000_000)).rejects.toThrow();
  });

  it('DA-06 — ver documento descarga del bucket privado el mismo archivo que se subió', async () => {
    const id = await nueva({ diasIncapacidad: '7' }); // 7: no es duplicado (HU-03)
    await control.registrarDocumentos(id, [documentoDePrueba({ tipo: 'epicrisis' })], receptor);
    const [{ idDocumento }] = (await baseDeDatos.obtenerExpediente(id)).documentos;
    const documento = await control.obtenerDocumento(idDocumento);
    expect(documento).toMatchObject({ idDocumento, idIncapacidad: id, tipo: 'epicrisis' });
    const archivo = await control.verDocumento(documento);
    expect(archivo.tipoMime).toBe('application/pdf');
    expect(archivo.nombre).toBe(`epicrisis-${idDocumento}.pdf`);
    expect(Buffer.compare(archivo.contenido, PDF)).toBe(0);
  });
});
