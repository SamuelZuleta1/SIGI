// Almacén de documentos: bucket privado `documentos` de Supabase Storage (RNF-03, HU-02.CA3).
// Solo el servidor (clave service role) lee y escribe. Única excepción: el navegador sube archivos grandes con una URL
// firmada de un solo uso a `pendientes/`, porque Vercel no admite más de 4,5 MB por petición; nunca lee el bucket.
import { BUCKET_DOCUMENTOS } from '../config/supabase.js';

export function crearAlmacenDocumentos(cliente) {
  const bucket = () => cliente.storage.from(BUCKET_DOCUMENTOS);
  return {
    /** Sube un archivo nuevo. No reemplaza uno existente. */
    async guardar(ruta, contenido, tipoMime) {
      const { error } = await bucket().upload(ruta, contenido, { contentType: tipoMime, upsert: false });
      if (error) throw error;
    },

    /** URL firmada para que el navegador suba UN archivo a `ruta` sin pasar por el servidor (vale 2 horas, no reemplaza). */
    async firmarSubida(ruta) {
      const { data, error } = await bucket().createSignedUploadUrl(ruta);
      if (error) throw error;
      return { urlFirmada: data.signedUrl };
    },

    /** URL firmada de lectura que caduca en `segundos` (DA-71), o null si el archivo no existe. */
    async firmarDescarga(ruta, segundos = 60) {
      const { data, error } = await bucket().createSignedUrl(ruta, segundos);
      if (error) {
        if (error.status === 404 || error.statusCode === '404' || /not found/i.test(error.message ?? '')) return null;
        throw error;
      }
      return data.signedUrl;
    },

    /** Descarga un archivo como Buffer (solo para el servidor: validar lo subido directo). */
    async descargar(ruta) {
      const { data, error } = await bucket().download(ruta);
      if (error) throw error;
      return Buffer.from(await data.arrayBuffer());
    },

    /** Borra archivos (para deshacer una subida que no se pudo registrar). */
    async eliminar(rutas) {
      if (rutas.length === 0) return;
      const { error } = await bucket().remove(rutas);
      if (error) throw error;
    },
  };
}
