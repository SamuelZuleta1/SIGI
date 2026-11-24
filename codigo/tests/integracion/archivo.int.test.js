// HU-29 contra Supabase (nube): preparar_archivo solo marca una pagada con todos sus pagos conciliados; al archivar se
// elimina la epicrisis de Storage y de `documento` (la historia clínica se conserva); deshacer quita la marca; con el
// archivo preparado registrar_pago ya no admite pagos (DA-11, DA-12, DA-59). HU-30: registrar_envio_archivo cierra el
// ciclo con quién y cuándo, solo una vez y solo con el archivo preparado; después nada lo deshace (DA-60).
// Requisitos: proyecto vinculado, migraciones aplicadas y `npm run db:usuarios`.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BUCKET_DOCUMENTOS, crearClienteServidor } from '../../src/config/supabase.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { ErrorDeAviso } from '../../src/controllers/error-de-aviso.js';
import { ErrorDeValidacion } from '../../src/controllers/error-de-validacion.js';
import { crearBaseDeDatos } from '../../src/persistence/base-de-datos.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { PDF } from '../helpers/fabricas.js';

const servidor = crearClienteServidor();
const baseDeDatos = crearBaseDeDatos(servidor);
const { correo, enviados } = crearCorreoFalso();
const control = crearControlIncapacidades({ baseDeDatos, correo });

const marca = `Prueba HU-29 ${Date.now()}`;
let auxiliar;
let entidad;
const incapacidades = [];
const conciliaciones = [];
const archivos = [];

const comprobar = ({ data, error }) => {
  if (error) throw error;
  return data;
};

/** Una pagada con su pago (HU-15). Devuelve { id, idPago }. */
async function pagada(nombre) {
  const colaborador = comprobar(
    await servidor.from('colaborador').insert({ nombre: `${marca} ${nombre}`, correo: `${Date.now()}.${incapacidades.length}@hu29.sigi.test`, creado_por: auxiliar.id }).select('id').single(),
  );
  const { id } = comprobar(
    await servidor
      .from('incapacidad')
      .insert({
        colaborador_id: colaborador.id, entidad_id: entidad.id, tipo: 'enfermedad_general', fecha_inicio: '2026-10-01',
        dias_incapacidad: 5, fecha_recepcion: '2026-10-02', estado: 'cobrada', tiempo_pago: 30, fecha_cobrada: '2026-10-05',
        creado_por: auxiliar.id,
      })
      .select('id')
      .single(),
  );
  incapacidades.push({ id, colaborador: colaborador.id });
  const idPago = comprobar(await servidor.rpc('registrar_pago', { p_incapacidad_id: id, p_valor: '420000.00', p_fecha_pago: '2026-11-10', p_creado_por: auxiliar.id }));
  return { id, idPago: Number(idPago) };
}

/** Marca el pago como identificado en una conciliación (lo que hace HU-26). */
async function conciliar(idPago) {
  const c = comprobar(await servidor.from('conciliacion').insert({ entidad_id: entidad.id, creado_por: auxiliar.id }).select('id').single());
  conciliaciones.push(c.id);
  comprobar(await servidor.from('pago').update({ conciliado: true, conciliacion_id: c.id }).eq('id', idPago));
}

/** Sube un documento al bucket y lo registra. Devuelve su ruta. */
async function documento(idIncapacidad, tipo) {
  const archivo = `incapacidades/${idIncapacidad}/${tipo}-${randomUUID()}.pdf`;
  comprobar(await servidor.storage.from(BUCKET_DOCUMENTOS).upload(archivo, PDF, { contentType: 'application/pdf' }));
  archivos.push(archivo);
  comprobar(await servidor.from('documento').insert({ incapacidad_id: idIncapacidad, tipo, archivo, creado_por: auxiliar.id }));
  return archivo;
}

// Con `info` y no con `download`: una descarga previa queda en la caché del CDN de Storage (max-age 3600) y se sigue
// sirviendo después de borrar el objeto; `info` dice si el objeto existe de verdad (DA-59).
const existeEnStorage = async (archivo) => !(await servidor.storage.from(BUCKET_DOCUMENTOS).info(archivo)).error;

beforeAll(async () => {
  const { data, error } = await servidor.from('usuario').select('id, correo, rol').eq('correo', 'auxiliar1@sigi.test').maybeSingle();
  if (error || !data) throw new Error('Faltan los usuarios de demostración: ejecute `npm run db:usuarios`');
  auxiliar = data;
  entidad = (await baseDeDatos.consultarEntidades()).at(-1);
});

afterAll(async () => {
  await servidor.storage.from(BUCKET_DOCUMENTOS).remove(archivos);
  for (const { id, colaborador } of incapacidades) {
    await servidor.from('incapacidad').delete().eq('id', id); // en cascada: pagos y documentos
    await servidor.from('colaborador').delete().eq('id', colaborador);
  }
  for (const id of conciliaciones) await servidor.from('conciliacion').delete().eq('id', id);
});

describe('HU-29 — archivo (persistencia real)', () => {
  it('HU-29.CA1 — la pagada aparece en la lista según su conciliación', async () => {
    const { id, idPago } = await pagada('Lista');
    expect((await control.consultarPagadas('sin_conciliar')).pagadas.map((p) => p.idIncapacidad)).toContain(id);
    await conciliar(idPago);
    const lista = await control.consultarPagadas('por_archivar');
    const fila = lista.pagadas.find((p) => p.idIncapacidad === id);
    expect(fila).toMatchObject({ colaborador: `${marca} Lista`, entidad: entidad.nombre, totalPagado: '420000.00', situacion: 'por_archivar' });
  });

  it('HU-29.CA2 — elimina la epicrisis del bucket y de documento, conserva la historia clínica y marca el archivo preparado', async () => {
    const { id, idPago } = await pagada('Archivar');
    await conciliar(idPago);
    const epicrisis = await documento(id, 'epicrisis');
    const historia = await documento(id, 'historia_clinica');
    expect(await existeEnStorage(epicrisis)).toBe(true);

    expect(await control.archivarIncapacidad(String(id), auxiliar)).toEqual({ idIncapacidad: id, epicrisisEliminadas: 1 });

    expect(await existeEnStorage(epicrisis)).toBe(false);
    expect(await existeEnStorage(historia)).toBe(true);
    const tipos = comprobar(await servidor.from('documento').select('tipo').eq('incapacidad_id', id)).map((d) => d.tipo);
    expect(tipos).toEqual(['historia_clinica']);
    const fila = comprobar(await servidor.from('incapacidad').select('fecha_archivo_preparado, archivo_preparado_por, enviada_a_gestion_documental').eq('id', id).single());
    expect(fila.fecha_archivo_preparado).not.toBeNull();
    expect(fila.archivo_preparado_por).toBe(auxiliar.id);
    expect(fila.enviada_a_gestion_documental).toBe(false);
    expect(enviados.at(-1).text).toContain(`Incapacidad n.º ${id}`);

    // Con el archivo preparado ya no se registran pagos, ni se prepara dos veces.
    expect(comprobar(await servidor.rpc('registrar_pago', { p_incapacidad_id: id, p_valor: '1.00', p_fecha_pago: '2026-11-11', p_creado_por: auxiliar.id }))).toBeNull();
    expect(await baseDeDatos.guardarArchivoPreparado(id, auxiliar.id)).toBe(false);
  });

  it('HU-29.CA3 — con un pago sin conciliar no se marca ni se elimina nada', async () => {
    const { id, idPago } = await pagada('Sin conciliar');
    await conciliar(idPago);
    comprobar(await servidor.rpc('registrar_pago', { p_incapacidad_id: id, p_valor: '1000.00', p_fecha_pago: '2026-11-12', p_creado_por: auxiliar.id }));
    const epicrisis = await documento(id, 'epicrisis');

    expect(await baseDeDatos.guardarArchivoPreparado(id, auxiliar.id)).toBe(false);
    const error = await control.archivarIncapacidad(String(id), auxiliar).catch((e) => e);
    expect(error).toBeInstanceOf(ErrorDeValidacion);
    expect(await existeEnStorage(epicrisis)).toBe(true);
  });

  it('deshacer_conciliacion quita la marca de archivo preparado de las incapacidades cuyos pagos libera', async () => {
    const { id, idPago } = await pagada('Deshacer');
    await conciliar(idPago);
    expect(await baseDeDatos.guardarArchivoPreparado(id, auxiliar.id)).toBe(true);
    comprobar(await servidor.rpc('deshacer_conciliacion', { p_id: conciliaciones.at(-1) }));
    const fila = comprobar(await servidor.from('incapacidad').select('fecha_archivo_preparado').eq('id', id).single());
    expect(fila.fecha_archivo_preparado).toBeNull();
    const pago = comprobar(await servidor.from('pago').select('conciliado').eq('id', idPago).single());
    expect(pago.conciliado).toBe(false);
  });

  it('si el correo falla se quita la marca y el reintento completa el archivo', async () => {
    const { id, idPago } = await pagada('Correo');
    await conciliar(idPago);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(correo, 'enviarParaArchivo').mockRejectedValueOnce(new Error('SMTP caído'));
    expect(await control.archivarIncapacidad(String(id), auxiliar).catch((e) => e)).toBeInstanceOf(ErrorDeAviso);
    const sinMarca = comprobar(await servidor.from('incapacidad').select('fecha_archivo_preparado, archivo_preparado_por').eq('id', id).single());
    expect(sinMarca).toEqual({ fecha_archivo_preparado: null, archivo_preparado_por: null });
    expect(await control.archivarIncapacidad(String(id), auxiliar)).toEqual({ idIncapacidad: id, epicrisisEliminadas: 0 });
  });

  it('B4 — si el correo falla, la epicrisis eliminada queda marcada y la verificación no la da por faltante', async () => {
    const { id, idPago } = await pagada('Correo epicrisis');
    await conciliar(idPago);
    await documento(id, 'epicrisis');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(correo, 'enviarParaArchivo').mockRejectedValueOnce(new Error('SMTP caído'));
    expect(await control.archivarIncapacidad(String(id), auxiliar).catch((e) => e)).toBeInstanceOf(ErrorDeAviso);
    const fila = comprobar(await servidor.from('incapacidad').select('fecha_archivo_preparado, epicrisis_eliminada_en').eq('id', id).single());
    expect(fila.fecha_archivo_preparado).toBeNull();
    expect(fila.epicrisis_eliminada_en).not.toBeNull();
    const { resultado } = await control.verificarDocumentacion(String(id));
    expect(resultado.requisitos.find((r) => r.tipo === 'epicrisis').estado).toBe('eliminada');
  });
});

describe('HU-30 — envío al archivo (persistencia real)', () => {
  it('HU-30.CA1 — registra el envío con quién y cuándo, una sola vez; queda en «Enviadas» con el correo de quien lo hizo', async () => {
    const { id, idPago } = await pagada('Envío');
    await conciliar(idPago);
    expect(await baseDeDatos.guardarEnvio(id, auxiliar.id)).toBe(false); // sin archivo preparado
    await control.archivarIncapacidad(String(id), auxiliar);

    expect(await control.registrarEnvioArchivo(String(id), { entregado: true }, auxiliar)).toEqual({ idIncapacidad: id });
    const fila = comprobar(
      await servidor.from('incapacidad').select('enviada_a_gestion_documental, fecha_envio_archivo, envio_archivo_por').eq('id', id).single(),
    );
    expect(fila.enviada_a_gestion_documental).toBe(true);
    expect(fila.fecha_envio_archivo).not.toBeNull();
    expect(fila.envio_archivo_por).toBe(auxiliar.id);

    expect(await baseDeDatos.guardarEnvio(id, auxiliar.id)).toBe(false);
    const otraVez = comprobar(await servidor.from('incapacidad').select('fecha_envio_archivo').eq('id', id).single());
    expect(otraVez.fecha_envio_archivo).toBe(fila.fecha_envio_archivo);

    const lista = await control.consultarPagadas('enviada');
    const enviada = lista.pagadas.find((p) => p.idIncapacidad === id);
    expect(enviada).toMatchObject({ situacion: 'enviada', envioArchivoPor: auxiliar.correo });
    expect(lista.conteos.enviada).toBeGreaterThanOrEqual(1);
    expect((await baseDeDatos.obtenerPagadas()).map((p) => p.idIncapacidad)).not.toContain(id);

    // Ya enviada: deshacer el archivo preparado no le quita las marcas y su conciliación ya no se deshace (DA-11).
    await baseDeDatos.deshacerArchivoPreparado(id);
    const { error: errorDeshacer } = await servidor.rpc('deshacer_conciliacion', { p_id: conciliaciones.at(-1) });
    expect(errorDeshacer?.code).toBe('SG001');
    const despues = comprobar(
      await servidor.from('incapacidad').select('enviada_a_gestion_documental, fecha_archivo_preparado').eq('id', id).single(),
    );
    expect(despues.enviada_a_gestion_documental).toBe(true);
    expect(despues.fecha_archivo_preparado).not.toBeNull();
    const susPagos = comprobar(await servidor.from('pago').select('conciliado, conciliacion_id').eq('incapacidad_id', id));
    expect(susPagos.every((p) => p.conciliado && p.conciliacion_id === conciliaciones.at(-1))).toBe(true);
  });

  it('las restricciones impiden marcarla enviada sin fecha o sin archivo preparado', async () => {
    const { id } = await pagada('Restricción');
    const { error } = await servidor.from('incapacidad').update({ enviada_a_gestion_documental: true }).eq('id', id);
    expect(error?.code).toBe('23514');
  });
});
