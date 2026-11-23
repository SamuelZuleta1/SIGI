// Grupo `reportes` de la Base de datos — DS-12 (CU-16).
// Operaciones: consultarDatosReporte y guardarReporte(tipo) (HU-27), con eliminarReporte para deshacer si el envío
// al SG-SST falla; consultarDatosProlongadas (HU-28, DA-58); y de apoyo, consultarReportes y consultarReporte. Sin
// migración: la tabla `reporte` ya tiene `contenido` (DA-21) y admite el tipo «prolongadas».
import { BLOQUE } from './alertas.persistence.js';
import { sumarIntervalo } from '../servicios/dias-habiles.js';

// Las incapacidades que empezaron más de VENTANA días antes del mes solo pueden tocarlo si duran más de VENTANA días:
// se leen aparte, para no leer todo el histórico.
export const VENTANA = 366;

const comprobar = ({ data, error }) => {
  if (error) throw error;
  return data;
};

const aReporte = (f) => ({ id: f.id, tipo: f.tipo, periodo: f.periodo, contenido: f.contenido, creadoEn: f.creado_en });

export function crearPersistenciaReportes(cliente) {
  return {
    /**
     * DS-12: consultarDatosReporte — las incapacidades que pueden tener algún día en el periodo [desde, hasta]: las
     * que empiezan en los VENTANA días anteriores o dentro del mes, y las más antiguas que duran más de VENTANA días.
     * El Control deja solo las que de verdad tocan el mes (consolidarDatos). En bloques, por el máximo de filas.
     */
    async consultarDatosReporte(desde, hasta) {
      const limite = sumarIntervalo(desde, { dias: -VENTANA });
      const leer = async (filtrar) => {
        const filas = [];
        for (;;) {
          const inicio = filas.length;
          const bloque = comprobar(
            await filtrar(
              cliente
                .from('incapacidad')
                .select('id, colaborador_id, tipo, fecha_inicio, dias_incapacidad, estado, colaborador(nombre), entidad(nombre)'),
            )
              .order('id')
              .range(inicio, inicio + BLOQUE - 1),
          );
          if (bloque.length === 0) break;
          filas.push(...bloque);
        }
        return filas;
      };
      const [recientes, largas] = await Promise.all([
        leer((q) => q.gte('fecha_inicio', limite).lte('fecha_inicio', hasta)),
        leer((q) => q.lt('fecha_inicio', limite).gt('dias_incapacidad', VENTANA)),
      ]);
      return [...largas, ...recientes].map((f) => ({
        idIncapacidad: f.id,
        idColaborador: f.colaborador_id,
        colaborador: f.colaborador.nombre,
        tipo: f.tipo,
        entidad: f.entidad.nombre,
        fechaInicio: f.fecha_inicio,
        diasIncapacidad: f.dias_incapacidad,
        estado: f.estado,
      }));
    },

    /**
     * DS-12: consultarDatosReporte del reporte de prolongadas (HU-28) — las incapacidades de más de `dias` días que
     * empiezan hasta `hasta`. El Control deja las que tocan el mes y las clasifica por hito. Del concepto solo se
     * necesita saber si existe (no se copia su texto al reporte). En bloques, por el máximo de filas.
     */
    async consultarDatosProlongadas(dias, hasta) {
      const filas = [];
      for (;;) {
        const inicio = filas.length;
        const bloque = comprobar(
          await cliente
            .from('incapacidad')
            .select(
              'id, colaborador_id, tipo, fecha_inicio, dias_incapacidad, estado, concepto, falta_concepto, pago_suspendido, colaborador(nombre), entidad(nombre)',
            )
            .gt('dias_incapacidad', dias)
            .lte('fecha_inicio', hasta)
            .order('id')
            .range(inicio, inicio + BLOQUE - 1),
        );
        if (bloque.length === 0) break;
        filas.push(...bloque);
      }
      return filas.map((f) => ({
        idIncapacidad: f.id,
        idColaborador: f.colaborador_id,
        colaborador: f.colaborador.nombre,
        tipo: f.tipo,
        entidad: f.entidad.nombre,
        fechaInicio: f.fecha_inicio,
        diasIncapacidad: f.dias_incapacidad,
        estado: f.estado,
        concepto: f.concepto == null ? null : true,
        faltaConcepto: f.falta_concepto,
        pagoSuspendido: f.pago_suspendido,
      }));
    },

    /** DS-12: guardarReporte(tipo) — con su contenido (DA-21) y quién lo generó (DA-23). @returns {Promise<number>} el id. */
    async guardarReporte(tipo, periodo, contenido, por) {
      const fila = comprobar(
        await cliente.from('reporte').insert({ tipo, periodo, contenido, creado_por: por }).select('id').single(),
      );
      return fila.id;
    },

    /** Deshace guardarReporte cuando el envío al SG-SST falla. */
    async eliminarReporte(id) {
      comprobar(await cliente.from('reporte').delete().eq('id', id));
    },

    /** Los reportes de un tipo, del más reciente al más antiguo. */
    async consultarReportes(tipo, limite) {
      const filas = comprobar(
        await cliente
          .from('reporte')
          .select('id, tipo, periodo, contenido, creado_en')
          .eq('tipo', tipo)
          .order('creado_en', { ascending: false })
          .order('id', { ascending: false })
          .limit(limite),
      );
      return filas.map(aReporte);
    },

    /** El último reporte de un tipo y periodo (para reconocer un doble envío); null si no hay. */
    async consultarUltimoReporte(tipo, periodo) {
      const fila = comprobar(
        await cliente
          .from('reporte')
          .select('id, tipo, periodo, contenido, creado_en')
          .eq('tipo', tipo)
          .eq('periodo', periodo)
          .order('creado_en', { ascending: false })
          .order('id', { ascending: false })
          .limit(1)
          .maybeSingle(),
      );
      return fila ? aReporte(fila) : null;
    },

    /** Un reporte guardado; null si no existe. */
    async consultarReporte(id) {
      const fila = comprobar(
        await cliente.from('reporte').select('id, tipo, periodo, contenido, creado_en').eq('id', id).maybeSingle(),
      );
      return fila ? aReporte(fila) : null;
    },
  };
}
