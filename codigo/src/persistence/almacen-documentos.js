// Almacén de documentos: bucket privado `documentos` de Supabase Storage (RNF-03, HU-02.CA3).
// Solo el servidor (clave service role) lee y escribe; el navegador nunca accede al bucket.
import { BUCKET_DOCUMENTOS } from '../config/supabase.js';

export function crearAlmacenDocumentos(cliente) {
  const bucket = () => cliente.storage.from(BUCKET_DOCUMENTOS);
  return {
    /** Sube un archivo nuevo. No reemplaza uno existente. */
    async guardar(ruta, contenido, tipoMime) {
      const { error } = await bucket().upload(ruta, contenido, { contentType: tipoMime, upsert: false });
      if (error) throw error;
    },

    /** Descarga un archivo como Buffer (DA-06: lo entrega el servidor, nunca el bucket al navegador). */
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
