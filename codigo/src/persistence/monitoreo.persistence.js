// Grupo `monitoreo` de la Base de datos — DS-10 (CU-14).
// Operaciones: consultarProlongadas y obtenerDatosProlongada (apoyo de la Vista), guardarConcepto (HU-22) y
// guardarFaltaConcepto (HU-23), con sus «deshacer» si el aviso al colaborador falla. Las escrituras son
// condicionadas: si otro usuario cambió la incapacidad entre la consulta y el registro, no se guarda nada.
import { BLOQUE } from './alertas.persistence.js';

const comprobar = ({ data, error }) => {
  if (error) throw error;
  return data;
};

const COLUMNAS =
  'id, tipo, fecha_inicio, dias_incapacidad, estado, concepto, falta_concepto, pago_suspendido, colaborador(nombre, correo), entidad(nombre)';

const aDatos = (f) => ({
  idIncapacidad: f.id,
  colaborador: f.colaborador.nombre,
  correoColaborador: f.colaborador.correo,
  entidad: f.entidad.nombre,
  tipo: f.tipo,
  fechaInicio: f.fecha_inicio,
  diasIncapacidad: f.dias_incapacidad,
  estado: f.estado,
  concepto: f.concepto,
  faltaConcepto: f.falta_concepto,
  pagoSuspendido: f.pago_suspendido,
});

export function crearPersistenciaMonitoreo(cliente) {
  return {
    /** DS-10: las incapacidades de más de `dias` días, las más largas primero. Se leen en bloques (máximo de la API). */
    async consultarProlongadas(dias) {
      const filas = [];
      for (;;) {
        const desde = filas.length;
        const bloque = comprobar(
          await cliente
            .from('incapacidad')
            .select(COLUMNAS)
            .gt('dias_incapacidad', dias)
            .order('dias_incapacidad', { ascending: false })
            .order('id')
            .range(desde, desde + BLOQUE - 1),
        );
        if (bloque.length === 0) break;
        filas.push(...bloque);
      }
      return filas.map(aDatos);
    },

    /** La incapacidad con lo que necesita el monitoreo. null si no existe. */
    async obtenerDatosProlongada(idIncapacidad) {
      const fila = comprobar(await cliente.from('incapacidad').select(COLUMNAS).eq('id', idIncapacidad).maybeSingle());
      return fila ? aDatos(fila) : null;
    },

    /**
     * DS-10: guardarConcepto(concepto) — HU-22. Solo si ya llegó al día del concepto (`diaMinimo`) y sin concepto; registrar el concepto
     * resuelve la «falta del concepto». @returns {Promise<boolean>} false si el estado ya no lo permitía.
     */
    async guardarConcepto(idIncapacidad, concepto, diaMinimo) {
      const filas = comprobar(
        await cliente
          .from('incapacidad')
          .update({ concepto, falta_concepto: false })
          .eq('id', idIncapacidad)
          .is('concepto', null)
          .gte('dias_incapacidad', diaMinimo)
          .select('id'),
      );
      return filas.length === 1;
    },

    /** Deshace el concepto recién guardado (si el aviso falló), devolviendo la marca de falta que tenía. */
    async deshacerConcepto(idIncapacidad, concepto, faltaConcepto) {
      comprobar(
        await cliente
          .from('incapacidad')
          .update({ concepto: null, falta_concepto: faltaConcepto })
          .eq('id', idIncapacidad)
          .eq('concepto', concepto),
      );
    },

    /**
     * DS-10: guardarFaltaConcepto() — HU-23. Solo si ya llegó al día del concepto, sin concepto y sin falta registrada.
     * @returns {Promise<boolean>} false si el estado ya no lo permitía.
     */
    async guardarFaltaConcepto(idIncapacidad, diaMinimo) {
      const filas = comprobar(
        await cliente
          .from('incapacidad')
          .update({ falta_concepto: true })
          .eq('id', idIncapacidad)
          .eq('falta_concepto', false)
          .is('concepto', null)
          .gte('dias_incapacidad', diaMinimo)
          .select('id'),
      );
      return filas.length === 1;
    },

    /** Deshace la falta recién guardada (si el aviso falló). */
    async deshacerFaltaConcepto(idIncapacidad) {
      comprobar(
        await cliente.from('incapacidad').update({ falta_concepto: false }).eq('id', idIncapacidad).is('concepto', null),
      );
    },
  };
}
