// HU-07 contra Supabase (nube): guardarFaltantes y la reapertura de registrar_documentos (DA-29, DA-31).
// Requisitos: proyecto vinculado, migración 20261117130127_reabrir_verificacion aplicada y `npm run db:usuarios`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUCKET_DOCUMENTOS, crearClienteServidor } from '../../src/config/supabase.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearBaseDeDatos } from '../../src/persistence/base-de-datos.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { documentoDePrueba, formularioDeRegistro, diasDistintos } from '../helpers/fabricas.js';

const diasDelCaso = diasDistintos(); // HU-03: sin duplicados entre las pruebas del archivo

const servidor = crearClienteServidor();
const baseDeDatos = crearBaseDeDatos(servidor);
const { correo, enviados } = crearCorreoFalso();
const control = crearControlIncapacidades({ baseDeDatos, correo, hoy: () => '2026-11-17' });
const bucket = servidor.storage.from(BUCKET_DOCUMENTOS);

const correoColaborador = `prueba.faltantes.${Date.now()}@sigi.test`;
const ids = [];
let receptor;
let entidad;

const nueva = async () => {
  const { idIncapacidad } = await control.registrarIncapacidad(
    formularioDeRegistro({ diasIncapacidad: diasDelCaso(), correoColaborador, entidad: String(entidad.id), tipo: 'accidente_transito' }),
    receptor,
  );
  ids.push(idIncapacidad);
  await control.registrarDocumentos(idIncapacidad, [documentoDePrueba()], receptor);
  return idIncapacidad;
};

const fila = async (id) => {
  const { data, error } = await servidor
    .from('incapacidad')
    .select('faltantes, fecha_aviso_faltantes, documentacion_completa, archivado_digital')
    .eq('id', id)
    .single();
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

describe('HU-07 — notificar faltantes (base de datos)', () => {
  it('HU-07.CA1 — guarda la lista, la fecha del aviso y documentacion_completa = false; el expediente trae el correo', async () => {
    const id = await nueva();
    await control.notificarFaltantes(id, ['epicrisis', 'furips']);
    expect(await fila(id)).toEqual({
      faltantes: ['epicrisis', 'furips'],
      fecha_aviso_faltantes: '2026-11-17',
      documentacion_completa: false,
      archivado_digital: false,
    });
    expect(enviados.at(-1).to).toBe(correoColaborador);
    const { aviso, incapacidad } = await control.verificarDocumentacion(id);
    expect(incapacidad.correoColaborador).toBe(correoColaborador);
    expect(aviso).toMatchObject({ fechaAviso: '2026-11-17', fechaLimite: '2026-11-20', pendiente: true });
  });

  it('DA-31 — guardarFaltantes no registra un segundo aviso pendiente (condición en la misma sentencia)', async () => {
    const id = await nueva();
    expect(await baseDeDatos.guardarFaltantes(id, ['furips'], '2026-11-17')).toBe(true);
    expect(await baseDeDatos.guardarFaltantes(id, ['epicrisis'], '2026-11-18')).toBe(false);
    expect(await fila(id)).toMatchObject({ faltantes: ['furips'], fecha_aviso_faltantes: '2026-11-17' });
  });

  it('HU-07.CA2 / DA-29 — registrar_documentos la reabre y conserva el último aviso', async () => {
    const id = await nueva();
    await control.notificarFaltantes(id, ['epicrisis', 'furips']);
    await control.registrarDocumentos(id, [documentoDePrueba({ tipo: 'epicrisis' })], receptor);
    expect(await fila(id)).toEqual({
      faltantes: ['epicrisis', 'furips'],
      fecha_aviso_faltantes: '2026-11-17',
      documentacion_completa: null,
      archivado_digital: false,
    });
  });

  it('DA-29 — documentos nuevos después de archivar reabren la verificación', async () => {
    const id = await nueva();
    await control.registrarDocumentos(id, [documentoDePrueba({ tipo: 'epicrisis' }), documentoDePrueba({ tipo: 'furips' })], receptor);
    await control.registrarVerificacion(id);
    expect(await fila(id)).toMatchObject({ documentacion_completa: true, archivado_digital: true });
    await control.registrarDocumentos(id, [documentoDePrueba({ tipo: 'historia_clinica' })], receptor);
    expect(await fila(id)).toMatchObject({ documentacion_completa: null, archivado_digital: false });
  });
});
