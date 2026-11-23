// Grupo `reportes` de la Base de datos — DS-12 (CU-16).
// Operaciones: consultarDatosReporte y guardarReporte(tipo) (HU-27), con eliminarReporte para deshacer si el envío
// al SG-SST falla; y de apoyo, consultarReportes y consultarReporte. Sin migración: la tabla `reporte` ya tiene
// `contenido` (DA-21).
import { BLOQUE } from './alertas.persistence.js';

const comprobar = ({ data, error }) => {
  if (error) throw error;
  return data;
};

const aReporte = (f) => ({ id: f.id, tipo: f.tipo, periodo: f.periodo, contenido: f.contenido, creadoEn: f.creado_en });

export function crearPersistenciaReportes(cliente) {
  return {
    /**
     * DS-12: consultarDatosReporte — las incapacidades que empiezan a más tardar el último día del periodo; el
     * Control deja las que tienen algún día dentro (consolidarDatos). En bloques, por el máximo de filas de Supabase.
     */
    async consultarDatosReporte(hasta) {
      const filas = [];
      for (;;) {
        const desde = filas.length;
        const bloque = comprobar(
          await cliente
            .from('incapacidad')
            .select('id, tipo, fecha_inicio, dias_incapacidad, estado, colaborador(nombre), entidad(nombre)')
            .lte('fecha_inicio', hasta)
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
        entidad: f.entidad.nombre,
        fechaInicio: f.fecha_inicio,
        diasIncapacidad: f.dias_incapacidad,
        estado: f.estado,
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

    /** Un reporte guardado; null si no existe. */
    async consultarReporte(id) {
      const fila = comprobar(
        await cliente.from('reporte').select('id, tipo, periodo, contenido, creado_en').eq('id', id).maybeSingle(),
      );
      return fila ? aReporte(fila) : null;
    },
  };
}
