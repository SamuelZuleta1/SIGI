// Grupo `radicacion` de la Base de datos — DS-04 (CU-06).
// Operaciones: obtenerDatosRadicacion (HU-09), guardarRadicacion (HU-10); apoyo para ver la evidencia.
import { randomUUID } from 'node:crypto';
import { crearAlmacenDocumentos } from './almacen-documentos.js';

const EXTENSIONES = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

const comprobar = ({ data, error }) => {
  if (error) throw error;
  return data;
};

export function crearPersistenciaRadicacion(cliente, almacen = crearAlmacenDocumentos(cliente)) {
  return {
    /**
     * DS-04: obtenerDatosRadicacion(idIncapacidad) → la incapacidad con su entidad y los plazos de
     * transcripción (los `interval` llegan como texto: «1 year», «150 days») y sus radicaciones
     * anteriores, de la más antigua a la más reciente (HU-10.CA2). null si no existe.
     */
    async obtenerDatosRadicacion(idIncapacidad) {
      const fila = comprobar(
        await cliente
          .from('incapacidad')
          .select(
            'id, tipo, fecha_inicio, dias_incapacidad, fecha_recepcion, fecha_nacimiento, estado, causal_rechazo, fecha_rechazo, motivo_traslado, ' +
              'documentacion_completa, archivado_digital, ' +
              'colaborador(nombre), entidad(nombre, tipo, plazo_transcripcion, plazo_transcripcion_transito, permite_transcripcion_digital), ' +
              'radicacion(id, radicado, evidencia, creado_en)',
          )
          .eq('id', idIncapacidad)
          .order('id', { referencedTable: 'radicacion' })
          .maybeSingle(),
      );
      if (!fila) return null;
      return {
        idIncapacidad: fila.id,
        colaborador: fila.colaborador.nombre,
        tipo: fila.tipo,
        fechaInicio: fila.fecha_inicio,
        diasIncapacidad: fila.dias_incapacidad,
        fechaRecepcion: fila.fecha_recepcion,
        fechaNacimiento: fila.fecha_nacimiento,
        estado: fila.estado,
        // DA-70: una trasladada a Cartera y Jurídica no se radica de nuevo.
        motivoTraslado: fila.motivo_traslado,
        causalRechazo: fila.causal_rechazo,
        fechaRechazo: fila.fecha_rechazo,
        documentacionCompleta: fila.documentacion_completa,
        archivadoDigital: fila.archivado_digital,
        entidad: {
          nombre: fila.entidad.nombre,
          tipo: fila.entidad.tipo,
          plazoTranscripcion: fila.entidad.plazo_transcripcion,
          plazoTranscripcionTransito: fila.entidad.plazo_transcripcion_transito,
          permiteTranscripcionDigital: fila.entidad.permite_transcripcion_digital,
        },
        radicaciones: fila.radicacion.map((r) => ({
          idRadicacion: r.id,
          radicado: r.radicado,
          conEvidencia: Boolean(r.evidencia),
          fecha: r.creado_en,
        })),
      };
    },

    /**
     * DS-04: guardarRadicacion(radicado, evidencia) — HU-10. Sube la evidencia al bucket privado
     * (incapacidades/{id}/radicacion-{uuid}.{ext}) y, en una transacción, guarda la radicación y pone
     * `estado = transcrita` (DA-01), solo si estaba registrada o rechazada (DA-36).
     * Si no se guarda, borra el archivo subido.
     * @returns {Promise<number | null>} id de la radicación; null si el estado ya no lo permitía.
     */
    async guardarRadicacion(idIncapacidad, { radicado, contenido, tipoMime }, creadoPor) {
      const evidencia = `incapacidades/${idIncapacidad}/radicacion-${randomUUID()}.${EXTENSIONES[tipoMime]}`;
      await almacen.guardar(evidencia, contenido, tipoMime);
      try {
        const id = comprobar(
          await cliente.rpc('registrar_radicacion', {
            p_incapacidad_id: idIncapacidad,
            p_radicado: radicado,
            p_evidencia: evidencia,
            p_creado_por: creadoPor,
          }),
        );
        if (id == null) await almacen.eliminar([evidencia]).catch(() => {});
        return id == null ? null : Number(id);
      } catch (error) {
        await almacen.eliminar([evidencia]).catch(() => {});
        throw error;
      }
    },

    /** Una radicación (sin el archivo), o null si no existe. */
    async consultarRadicacion(idRadicacion) {
      const fila = comprobar(
        await cliente.from('radicacion').select('id, incapacidad_id, radicado, evidencia').eq('id', idRadicacion).maybeSingle(),
      );
      return fila && { idRadicacion: fila.id, idIncapacidad: fila.incapacidad_id, radicado: fila.radicado, evidencia: fila.evidencia };
    },
  };
}
