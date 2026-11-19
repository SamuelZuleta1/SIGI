// Grupo `radicacion` de la Base de datos — DS-04 (CU-06).
// Operaciones: obtenerDatosRadicacion (HU-09). guardarRadicacion llega con HU-10.

const comprobar = ({ data, error }) => {
  if (error) throw error;
  return data;
};

export function crearPersistenciaRadicacion(cliente) {
  return {
    /**
     * DS-04: obtenerDatosRadicacion(idIncapacidad) → la incapacidad con su entidad y los plazos de
     * transcripción (los `interval` llegan como texto: «1 year», «150 days»). null si no existe.
     */
    async obtenerDatosRadicacion(idIncapacidad) {
      const fila = comprobar(
        await cliente
          .from('incapacidad')
          .select(
            'id, tipo, fecha_inicio, dias_incapacidad, fecha_nacimiento, estado, documentacion_completa, archivado_digital, ' +
              'colaborador(nombre), entidad(nombre, tipo, plazo_transcripcion, plazo_transcripcion_transito, permite_transcripcion_digital)',
          )
          .eq('id', idIncapacidad)
          .maybeSingle(),
      );
      if (!fila) return null;
      return {
        idIncapacidad: fila.id,
        colaborador: fila.colaborador.nombre,
        tipo: fila.tipo,
        fechaInicio: fila.fecha_inicio,
        diasIncapacidad: fila.dias_incapacidad,
        fechaNacimiento: fila.fecha_nacimiento,
        estado: fila.estado,
        documentacionCompleta: fila.documentacion_completa,
        archivadoDigital: fila.archivado_digital,
        entidad: {
          nombre: fila.entidad.nombre,
          tipo: fila.entidad.tipo,
          plazoTranscripcion: fila.entidad.plazo_transcripcion,
          plazoTranscripcionTransito: fila.entidad.plazo_transcripcion_transito,
          permiteTranscripcionDigital: fila.entidad.permite_transcripcion_digital,
        },
      };
    },
  };
}
