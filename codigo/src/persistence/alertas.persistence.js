// Grupo `alertas` de la Base de datos — DS-14 (CU-09).
// Operación: consultarPlazos → las incapacidades que pueden tener un plazo abierto (HU-12). Solo lectura.
import { HITOS } from '../controllers/alertas.controller.js';
import { COLUMNAS_CASO, aCaso } from './caso.js';

// Filas por consulta: igual al máximo que entrega la API de Supabase (supabase/config.toml, max_rows).
export const BLOQUE = 1000;

const comprobar =({ data, error }) => {
  if (error) throw error;
  return data;
};

export function crearPersistenciaAlertas(cliente) {
  return {
    /**
     * DS-14: consultarPlazos → incapacidades con algún plazo que vigilar (DA-37): sin radicar (registrada o
     * rechazada: envío, transcripción y paternidad), con un aviso de faltantes pendiente (subsanación) o que
     * duran 90 días o más (hitos). El Control decide cuáles están por vencer o vencidas.
     * Los `interval` de la entidad llegan como texto («1 year», «15 days»).
     */
    async consultarPlazos() {
      // Supabase entrega un máximo de filas por consulta (max_rows): se leen en bloques hasta que uno llegue
      // vacío. Se avanza por las filas recibidas, así sirve aunque el máximo sea menor que BLOQUE.
      const filas = [];
      for (;;) {
        const desde = filas.length;
        const bloque = comprobar(
          await cliente
            .from('incapacidad')
            .select(
              'id, tipo, fecha_inicio, dias_incapacidad, fecha_recepcion, fecha_nacimiento, estado, motivo_traslado, ' +
                'documentacion_completa, fecha_aviso_faltantes, segundo_llamado, ' +
                `${COLUMNAS_CASO}, colaborador(nombre), entidad(nombre, plazo_transcripcion, plazo_transcripcion_transito)`,
            )
            .or(`estado.is.null,estado.eq.rechazada,documentacion_completa.is.false,dias_acumulados.gte.${HITOS[0]}`)
            .order('id')
            .range(desde, desde + BLOQUE - 1),
        );
        if (bloque.length === 0) break;
        filas.push(...bloque);
      }
      return filas.map((f) => ({
        idIncapacidad: f.id,
        colaborador: f.colaborador.nombre,
        tipo: f.tipo,
        fechaInicio: f.fecha_inicio,
        diasIncapacidad: f.dias_incapacidad,
        fechaRecepcion: f.fecha_recepcion,
        fechaNacimiento: f.fecha_nacimiento,
        estado: f.estado,
        motivoTraslado: f.motivo_traslado, // DA-70: sin alerta de transcripción una vez trasladada
        documentacionCompleta: f.documentacion_completa,
        fechaAvisoFaltantes: f.fecha_aviso_faltantes,
        segundoLlamado: f.segundo_llamado,
        ...aCaso(f),
        entidad: {
          nombre: f.entidad.nombre,
          plazoTranscripcion: f.entidad.plazo_transcripcion,
          plazoTranscripcionTransito: f.entidad.plazo_transcripcion_transito,
        },
      }));
    },
  };
}
