// Pruebas contra Supabase (nube). Requisitos: proyecto vinculado y `npm run db:usuarios`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUCKET_DOCUMENTOS, crearClientePublico, crearClienteServidor } from '../../src/config/supabase.js';
import { crearTransporte, destinatariosPorArea, remitente } from '../../src/config/correo.js';
import { crearServicioCorreo } from '../../src/servicios/correo.js';
import { ROLES } from '../../src/models/usuario.model.js';
import { incapacidadDePrueba } from '../helpers/fabricas.js';

const servidor = crearClienteServidor();
const publico = crearClientePublico();

const TABLAS = [
  'usuario', 'colaborador', 'entidad', 'incapacidad', 'documento', 'reemplazo', 'radicacion',
  'requerimiento', 'seguimiento', 'acuerdo_pago', 'pago', 'pago_consignado', 'conciliacion', 'reporte',
];

let auxiliar;
let colaboradorId;
let entidadId;
const rutaArchivo = `pruebas/base-${Date.now()}.pdf`;

beforeAll(async () => {
  const { data: usuario, error } = await servidor.from('usuario').select('id').eq('correo', 'auxiliar1@sigi.test').single();
  if (error) throw new Error('Faltan los usuarios de demostración: ejecute `npm run db:usuarios`');
  auxiliar = usuario.id;
  const { data: entidad } = await servidor.from('entidad').select('id').eq('nombre', 'Nueva EPS').single();
  entidadId = entidad.id;
  const { data: colaborador, error: errorColaborador } = await servidor
    .from('colaborador')
    .insert({ nombre: 'Prueba Base', correo: `prueba.base.${Date.now()}@sigi.test`, creado_por: auxiliar })
    .select('id')
    .single();
  if (errorColaborador) throw errorColaborador;
  colaboradorId = colaborador.id;
});

afterAll(async () => {
  await servidor.from('incapacidad').delete().eq('colaborador_id', colaboradorId);
  await servidor.from('colaborador').delete().eq('id', colaboradorId);
  await servidor.storage.from(BUCKET_DOCUMENTOS).remove([rutaArchivo]);
});

const incapacidad = (cambios = {}) => ({
  colaborador_id: colaboradorId,
  entidad_id: entidadId,
  tipo: 'enfermedad_general',
  fecha_inicio: '2026-11-03',
  dias_incapacidad: 5,
  fecha_recepcion: '2026-11-04',
  creado_por: auxiliar,
  ...cambios,
});

describe('T-00b — esquema', () => {
  it.each(TABLAS)('la tabla %s existe y el servidor la lee', async (tabla) => {
    const { error } = await servidor.from(tabla).select('*', { head: true, count: 'exact' });
    expect(error).toBeNull();
  });

  it.each(TABLAS)('la clave pública no puede leer %s (RLS sin políticas)', async (tabla) => {
    const { data, error } = await publico.from(tabla).select('*');
    expect(error ?? data).toSatisfy((r) => (Array.isArray(r) ? r.length === 0 : Boolean(r.message)));
  });

  it('la clave pública no puede insertar', async () => {
    const { error } = await publico.from('entidad').insert({ nombre: 'Intrusa', tipo: 'EPS' });
    expect(error).not.toBeNull();
  });

  it('una incapacidad nueva queda sin estado y con sus valores iniciales', async () => {
    const { data, error } = await servidor.from('incapacidad').insert(incapacidad()).select().single();
    expect(error).toBeNull();
    expect(data.estado).toBeNull();
    expect(data.documentacion_completa).toBeNull();
    expect(data.faltantes).toEqual([]);
    expect(data.original_pendiente).toBe(false);
    expect(data.creado_en).toBeTruthy();
  });

  it.each([
    ['un tipo fuera de los 6', { tipo: 'vacaciones' }],
    ['un estado inválido', { estado: 'archivada' }],
    ['días en cero', { dias_incapacidad: 0 }],
    ['una decisión inválida', { decision: 'tutela' }],
  ])('rechaza %s', async (_caso, cambios) => {
    const { error } = await servidor.from('incapacidad').insert(incapacidad(cambios));
    expect(error?.code).toBe('23514');
  });

  it('exige el usuario que registra (DA-23)', async () => {
    const { error } = await servidor.from('incapacidad').insert(incapacidad({ creado_por: null }));
    expect(error?.code).toBe('23502');
  });
});

describe('HU-02.CA3 — bucket privado de documentos, sin acceso desde el navegador (RNF-03)', () => {
  it('el bucket existe y es privado', async () => {
    const { data, error } = await servidor.storage.getBucket(BUCKET_DOCUMENTOS);
    expect(error).toBeNull();
    expect(data.public).toBe(false);
  });

  it('el servidor sube y descarga; sin la clave de servidor no se puede', async () => {
    const pdf = new Blob(['%PDF-1.4 prueba'], { type: 'application/pdf' });
    const subida = await servidor.storage.from(BUCKET_DOCUMENTOS).upload(rutaArchivo, pdf);
    expect(subida.error).toBeNull();

    const descarga = await servidor.storage.from(BUCKET_DOCUMENTOS).download(rutaArchivo);
    expect(descarga.error).toBeNull();

    const anonima = await publico.storage.from(BUCKET_DOCUMENTOS).download(rutaArchivo);
    expect(anonima.error).not.toBeNull();

    const { data } = publico.storage.from(BUCKET_DOCUMENTOS).getPublicUrl(rutaArchivo);
    const respuesta = await fetch(data.publicUrl);
    expect(respuesta.ok).toBe(false);
  });

  it('rechaza tipos de archivo no permitidos', async () => {
    const { error } = await servidor.storage
      .from(BUCKET_DOCUMENTOS)
      .upload(`pruebas/malo-${Date.now()}.exe`, new Blob(['MZ'], { type: 'application/x-msdownload' }));
    expect(error).not.toBeNull();
  });
});

describe('T-00c — datos iniciales', () => {
  it('carga las 7 entidades con sus plazos (§5.2.1)', async () => {
    const { data } = await servidor.from('entidad').select('*').order('nombre');
    expect(data.map((e) => e.nombre).sort()).toEqual(
      ['ARL SURA', 'Asmet Salud', 'Nueva EPS', 'SOS', 'SURA EPS', 'Salud Total', 'Sanitas'].sort(),
    );
    const porNombre = Object.fromEntries(data.map((e) => [e.nombre, e]));
    expect(porNombre['SURA EPS'].plazo_transcripcion).toBe('150 days');
    expect(porNombre.Sanitas.plazo_transcripcion).toBe('3 years');
    expect(porNombre['Salud Total'].plazo_transcripcion_transito).toBe('15 days');
    expect(porNombre.SOS.permite_transcripcion_digital).toBe(false);
    expect(porNombre.Sanitas.permite_transcripcion_digital).toBe(false);
    expect(porNombre['ARL SURA'].tipo).toBe('ARL');
  });

  it('hay 10 usuarios de demostración, 2 por rol (DA-02)', async () => {
    const { data } = await servidor.from('usuario').select('correo, rol').like('correo', '%@sigi.test');
    expect(data).toHaveLength(10);
    for (const rol of ROLES) expect(data.filter((u) => u.rol === rol)).toHaveLength(2);
  });

  it('no se puede crear una cuenta desde fuera (registro cerrado)', async () => {
    const { error } = await publico.auth.signUp({ email: `intruso.${Date.now()}@sigi.test`, password: 'Clave-segura-123' });
    expect(error).not.toBeNull();
  });
});

describe('T-00d — el correo llega a Mailpit (DA-02 e)', () => {
  it('envía una notificación por SMTP y aparece en la bandeja', async () => {
    const correo = crearServicioCorreo({
      transporte: crearTransporte(),
      remitente: remitente(),
      destinatarios: destinatariosPorArea(),
    });
    const marca = Date.now();
    await correo.notificarRecepcion(incapacidadDePrueba({ idIncapacidad: marca }));

    const respuesta = await fetch(`${process.env.MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`subject:"${marca}"`)}`);
    const { messages } = await respuesta.json();
    expect(messages).toHaveLength(1);
    expect(messages[0].To[0].Address).toBe(process.env.CORREO_AUXILIAR);
  });
});
