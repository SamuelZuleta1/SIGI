// Grupo `verificacion` de la Base de datos — DS-03 (CU-04).
// Operaciones: obtenerExpediente, archivarDigital; apoyo para «ver documento» (DA-06):
// consultarDocumento y descargarDocumento.
import { crearAlmacenDocumentos } from './almacen-documentos.js';

const comprobar = ({ data, error }) => {
  if (error) throw error;
  return data;
};

// El tipo del archivo sale de la extensión que le puso el servidor al guardarlo (HU-04), no del bucket.
const TIPOS_MIME = { pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png' };

export function crearPersistenciaVerificacion(cliente, almacen = crearAlmacenDocumentos(cliente)) {
  return {
    /**
     * DS-03: obtenerExpediente(idIncapacidad) → expediente: la incapacidad y sus documentos,
     * en una sola consulta. null si no existe. No trae el contenido de los archivos.
     */
    async obtenerExpediente(idIncapacidad) {
      const fila = comprobar(
        await cliente
          .from('incapacidad')
          .select(
            'id, tipo, fecha_inicio, dias_incapacidad, original_pendiente, documentacion_completa, archivado_digital, ' +
              'colaborador(nombre), entidad(nombre), documento(id, tipo)',
          )
          .eq('id', idIncapacidad)
          .order('id', { referencedTable: 'documento' })
          .maybeSingle(),
      );
      if (!fila) return null;
      return {
        idIncapacidad: fila.id,
        colaborador: fila.colaborador.nombre,
        tipo: fila.tipo,
        entidad: fila.entidad.nombre,
        fechaInicio: fila.fecha_inicio,
        diasIncapacidad: fila.dias_incapacidad,
        originalPendiente: fila.original_pendiente,
        documentacionCompleta: fila.documentacion_completa,
        archivadoDigital: fila.archivado_digital,
        documentos: fila.documento.map((d) => ({ idDocumento: d.id, tipo: d.tipo })),
      };
    },

    /**
     * DS-03: archivarDigital(idIncapacidad). Los archivos ya están en el bucket por colaborador
     * y fecha (CAR-10); aquí se registra la verificación: documentación completa y archivada.
     * Una sola sentencia sobre una fila: no necesita transacción aparte.
     */
    async archivarDigital(idIncapacidad) {
      const filas = comprobar(
        await cliente
          .from('incapacidad')
          .update({ documentacion_completa: true, archivado_digital: true })
          .eq('id', idIncapacidad)
          .select('id'),
      );
      if (filas.length !== 1) throw new Error(`No se pudo archivar la incapacidad ${idIncapacidad}`);
    },

    /** Datos de un documento (sin el archivo), o null si no existe. */
    async consultarDocumento(idDocumento) {
      const fila = comprobar(
        await cliente.from('documento').select('id, incapacidad_id, tipo, archivo').eq('id', idDocumento).maybeSingle(),
      );
      return fila && { idDocumento: fila.id, idIncapacidad: fila.incapacidad_id, tipo: fila.tipo, archivo: fila.archivo };
    },

    /** Descarga el archivo del bucket privado. */
    async descargarDocumento(archivo) {
      const contenido = await almacen.descargar(archivo);
      return { contenido, tipoMime: TIPOS_MIME[archivo.split('.').pop()] ?? 'application/octet-stream' };
    },
  };
}
