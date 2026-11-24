// Grupo `verificacion` de la Base de datos — DS-03 (CU-04).
// Operaciones: obtenerExpediente, archivarDigital, guardarFaltantes (HU-07), guardarSegundoLlamado (HU-08);
// apoyo para «ver documento» (DA-06):
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
            'id, tipo, fecha_inicio, dias_incapacidad, original_pendiente, documentacion_completa, archivado_digital, fecha_archivo_preparado, ' +
              'faltantes, fecha_aviso_faltantes, segundo_llamado, colaborador(nombre, correo), entidad(nombre), documento(id, tipo)',
          )
          .eq('id', idIncapacidad)
          .order('id', { referencedTable: 'documento' })
          .maybeSingle(),
      );
      if (!fila) return null;
      return {
        idIncapacidad: fila.id,
        colaborador: fila.colaborador.nombre,
        correoColaborador: fila.colaborador.correo,
        tipo: fila.tipo,
        entidad: fila.entidad.nombre,
        fechaInicio: fila.fecha_inicio,
        diasIncapacidad: fila.dias_incapacidad,
        originalPendiente: fila.original_pendiente,
        documentacionCompleta: fila.documentacion_completa,
        archivadoDigital: fila.archivado_digital,
        // HU-29 (DA-59): con el archivo preparado la epicrisis ya se eliminó.
        archivoPreparado: fila.fecha_archivo_preparado != null,
        faltantes: fila.faltantes,
        fechaAvisoFaltantes: fila.fecha_aviso_faltantes,
        segundoLlamado: fila.segundo_llamado,
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

    /**
     * DS-03: guardarFaltantes(idIncapacidad, faltantes) — HU-07.CA1. Guarda la lista y la fecha del aviso
     * (DA-13) y deja la documentación como incompleta (false = faltantes notificados).
     * Un aviso nuevo tiene su propio segundo llamado (DA-33): segundo_llamado vuelve a false.
     * Solo si no había un aviso pendiente (DA-31): la condición va en la misma sentencia, así dos avisos
     * simultáneos no se registran los dos.
     * @returns {Promise<boolean>} false si ya había un aviso pendiente o la incapacidad no existe.
     */
    async guardarFaltantes(idIncapacidad, faltantes, fechaAviso) {
      const filas = comprobar(
        await cliente
          .from('incapacidad')
          .update({ faltantes, fecha_aviso_faltantes: fechaAviso, documentacion_completa: false, segundo_llamado: false })
          .eq('id', idIncapacidad)
          .or('documentacion_completa.is.null,documentacion_completa.eq.true')
          .select('id'),
      );
      return filas.length === 1;
    },

    /**
     * DS-03: guardarSegundoLlamado(idIncapacidad) — HU-08.CA1. Marca segundo_llamado = true.
     * Solo sobre el aviso que se vio en pantalla: sigue pendiente (documentacion_completa = false), es el
     * mismo (fecha_aviso_faltantes) y no tiene ya su segundo llamado (DA-33). La condición va en la misma
     * sentencia, así dos registros simultáneos no se guardan los dos.
     * @returns {Promise<boolean>} false si el aviso cambió, ya no está pendiente o ya tenía el llamado.
     */
    async guardarSegundoLlamado(idIncapacidad, fechaAviso) {
      const filas = comprobar(
        await cliente
          .from('incapacidad')
          .update({ segundo_llamado: true })
          .eq('id', idIncapacidad)
          .eq('documentacion_completa', false)
          .eq('fecha_aviso_faltantes', fechaAviso)
          .eq('segundo_llamado', false)
          .select('id'),
      );
      return filas.length === 1;
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
