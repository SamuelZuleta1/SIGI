// HU-08 contra Supabase (nube): guardarSegundoLlamado y su reinicio con un aviso nuevo (DA-32, DA-33).
// Requisitos: proyecto vinculado y `npm run db:usuarios`. No necesita migración: segundo_llamado viene del esquema inicial.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUCKET_DOCUMENTOS, crearClienteServidor } from '../../src/config/supabase.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearBaseDeDatos } from '../../src/persistence/base-de-datos.js';
import { crearCorreoFalso, DESTINATARIOS } from '../helpers/correo-falso.js';
import { documentoDePrueba, formularioDeRegistro, diasDistintos } from '../helpers/fabricas.js';

const diasDelCaso = diasDistintos(); // HU-03: sin duplicados entre las pruebas del archivo

const servidor = crearClienteServidor();
const baseDeDatos = crearBaseDeDatos(servidor);
const { correo, enviados } = crearCorreoFalso();
let hoy = '2026-11-17';
const control = crearControlIncapacidades({ baseDeDatos, correo, hoy: () => hoy });
const bucket = servidor.storage.from(BUCKET_DOCUMENTOS);

const correoColaborador = `prueba.llamado.${Date.now()}@sigi.test`;
const ids = [];
let receptor;
let entidad;

// Incapacidad con aviso del martes 17 por la epicrisis y el FURIPS (vence el viernes 20).
const conAviso = async () => {
  hoy = '2026-11-17';
  const { idIncapacidad } = await control.registrarIncapacidad(
    formularioDeRegistro({ diasIncapacidad: diasDelCaso(), correoColaborador, entidad: String(entidad.id), tipo: 'accidente_transito' }),
    receptor,
  );
  ids.push(idIncapacidad);
  await control.registrarDocumentos(idIncapacidad, [documentoDePrueba()], receptor);
  await control.notificarFaltantes(idIncapacidad, ['epicrisis', 'furips']);
  return idIncapacidad;
};

const fila = async (id) => {
  const { data, error } = await servidor
    .from('incapacidad')
    .select('segundo_llamado, documentacion_completa, fecha_aviso_faltantes')
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

describe('HU-08 — segundo llamado (base de datos)', () => {
  it('HU-08.CA1 — guarda segundo_llamado = true, deja la documentación incompleta y avisa a la Coordinación', async () => {
    const id = await conAviso();
    hoy = '2026-11-23';
    await control.registrarSegundoLlamado(id);
    expect(await fila(id)).toEqual({ segundo_llamado: true, documentacion_completa: false, fecha_aviso_faltantes: '2026-11-17' });
    expect(enviados.at(-1).to).toBe(DESTINATARIOS.coordinacion);
    const { aviso } = await control.verificarDocumentacion(id);
    expect(aviso).toMatchObject({ segundoLlamado: true, vencido: true, pendiente: true });
  });

  it('DA-33 — la condición va en la sentencia: otro aviso, uno ya llamado o uno no pendiente no se marcan', async () => {
    const id = await conAviso();
    expect(await baseDeDatos.guardarSegundoLlamado(id, '2026-11-10')).toBe(false); // otro aviso
    expect(await baseDeDatos.guardarSegundoLlamado(id, '2026-11-17')).toBe(true);
    expect(await baseDeDatos.guardarSegundoLlamado(id, '2026-11-17')).toBe(false); // ya tenía el llamado

    const otra = await conAviso();
    await control.registrarDocumentos(otra, [documentoDePrueba({ tipo: 'epicrisis' })], receptor); // ya no está pendiente
    expect(await baseDeDatos.guardarSegundoLlamado(otra, '2026-11-17')).toBe(false);
    expect((await fila(otra)).segundo_llamado).toBe(false);
  });

  it('DA-33 — un aviso nuevo vuelve a poner segundo_llamado = false', async () => {
    const id = await conAviso();
    hoy = '2026-11-23';
    await control.registrarSegundoLlamado(id);
    await control.registrarDocumentos(id, [documentoDePrueba({ tipo: 'epicrisis' })], receptor);
    expect((await fila(id)).segundo_llamado).toBe(true); // registrar documentos conserva el registro
    hoy = '2026-11-24';
    await control.notificarFaltantes(id, ['furips']);
    expect(await fila(id)).toEqual({ segundo_llamado: false, documentacion_completa: false, fecha_aviso_faltantes: '2026-11-24' });
  });
});
