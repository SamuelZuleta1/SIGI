// Grupo `subidas` de la Persistencia: archivos que el navegador sube directo al bucket privado (límite de 4,5 MB por
// petición en Vercel). Quedan en `pendientes/{idUsuario}/{uuid}` hasta que el servidor los valida y los registra.
import { randomUUID } from 'node:crypto';
import { crearAlmacenDocumentos } from './almacen-documentos.js';

export function crearPersistenciaSubidas(cliente, almacen = crearAlmacenDocumentos(cliente)) {
  return {
    /** Reserva una ruta pendiente para el usuario y devuelve la URL firmada con la que el navegador sube el archivo. */
    async prepararSubida(idUsuario) {
      const ruta = `pendientes/${idUsuario}/${randomUUID()}`;
      const { urlFirmada } = await almacen.firmarSubida(ruta);
      return { ruta, urlFirmada };
    },

    /** Descarga lo subido, o null si no está (nunca se subió o ya se descartó). */
    async descargarSubida(ruta) {
      try {
        return await almacen.descargar(ruta);
      } catch (error) {
        if (error?.status === 404 || error?.statusCode === '404' || /not found/i.test(error?.message ?? '')) return null;
        throw error;
      }
    },

    /**
     * DA-71: URL firmada (60 s) para ver un archivo guardado. El permiso se comprueba antes en la ruta; el archivo viaja
     * del bucket al navegador sin pasar por la función (Vercel no admite respuestas de más de 4,5 MB). null si no existe.
     */
    async enlaceDeArchivo(ruta) {
      return almacen.firmarDescarga(ruta);
    },

    /** Borra los archivos pendientes ya usados o rechazados. */
    async eliminarSubidas(rutas) {
      await almacen.eliminar(rutas);
    },
  };
}
