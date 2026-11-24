// Grupo `monitoreo` de la Base de datos — DS-10 (CU-14).
// Operaciones: consultarProlongadas y obtenerDatosProlongada (apoyo de la Vista), guardarConcepto (HU-22) y
// guardarFaltaConcepto (HU-23) y guardarSuspensionPago (HU-24), con sus «deshacer» si el aviso al colaborador falla. Las escrituras son
// condicionadas: si otro usuario cambió la incapacidad entre la consulta y el registro, no se guarda nada.
import { BLOQUE } from './alertas.persistence.js';
import { COLUMNAS_CASO, aCaso, columnaDelDia } from './caso.js';

const comprobar = ({ data, error }) => {
  if (error) throw error;
  return data;
};

const COLUMNAS =
  'id, tipo, fecha_inicio, dias_incapacidad, estado, concepto, falta_concepto, pago_suspendido, fecha_concepto, fecha_falta_concepto, fecha_suspension, ' +
  `${COLUMNAS_CASO}, colaborador(nombre, correo), entidad(nombre)`;

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
  // Auditoría (DA-23): cuándo se registró cada cosa.
  fechaConcepto: f.fecha_concepto,
  fechaFaltaConcepto: f.fecha_falta_concepto,
  fechaSuspension: f.fecha_suspension,
  ...aCaso(f),
});

// Quién y cuándo (DA-23). `por` es el id del usuario que registra.
const ahora = () => new Date().toISOString();

export function crearPersistenciaMonitoreo(cliente) {
  return {
    /**
     * DS-10: los casos de más de `dias` días (DA-50: días acumulados, en su certificado vigente), los más largos primero.
     * Se leen en bloques (máximo de la API).
     */
    async consultarProlongadas(dias) {
      const filas = [];
      for (;;) {
        const desde = filas.length;
        const bloque = comprobar(
          await cliente
            .from('incapacidad')
            .select(COLUMNAS)
            .gt('dias_acumulados', dias)
            .eq('tiene_prorroga', false)
            .order('dias_acumulados', { ascending: false })
            .order('id')
            .range(desde, desde + BLOQUE - 1),
        );
        if (bloque.length === 0) break;
        filas.push(...bloque);
      }
      return filas.map(aDatos);
    },

    /** La incapacidad con lo que necesita el monitoreo y, si ya tiene prórroga, su número. null si no existe. */
    async obtenerDatosProlongada(idIncapacidad) {
      const fila = comprobar(await cliente.from('incapacidad').select(COLUMNAS).eq('id', idIncapacidad).maybeSingle());
      if (!fila) return null;
      const datos = aDatos(fila);
      if (datos.tieneProrroga) {
        const siguiente = comprobar(await cliente.from('incapacidad').select('id').eq('prorroga_de', idIncapacidad).maybeSingle());
        datos.prorroga = siguiente?.id ?? null;
      }
      return datos;
    },

    /**
     * DS-10: guardarConcepto(concepto) — HU-22. Solo si ya llegó al día del concepto y sin concepto; registrar el concepto
     * resuelve la «falta del concepto». `dia` es la condición de hitos.js (DA-49, DA-50): `fecha_dia_N <= hoy` en el
     * certificado vigente del caso. @returns {Promise<boolean>} false si el estado ya no lo permitía.
     */
    async guardarConcepto(idIncapacidad, concepto, dia, por) {
      const filas = comprobar(
        await cliente
          .from('incapacidad')
          .update({ concepto, falta_concepto: false, fecha_concepto: ahora(), concepto_por: por })
          .eq('id', idIncapacidad)
          .is('concepto', null)
          .lte(columnaDelDia(dia.n), dia.hoy)
          .eq('tiene_prorroga', false)
          .select('id'),
      );
      return filas.length === 1;
    },

    /** Deshace el concepto recién guardado (si el aviso falló), devolviendo la marca de falta que tenía. */
    async deshacerConcepto(idIncapacidad, concepto, faltaConcepto) {
      comprobar(
        await cliente
          .from('incapacidad')
          .update({ concepto: null, falta_concepto: faltaConcepto, fecha_concepto: null, concepto_por: null })
          .eq('id', idIncapacidad)
          .eq('concepto', concepto),
      );
    },

    /**
     * DS-10: guardarFaltaConcepto() — HU-23. Solo si ya llegó al día del concepto (`dia`, como en guardarConcepto), sin
     * concepto y sin falta registrada. @returns {Promise<boolean>} false si el estado ya no lo permitía.
     */
    async guardarFaltaConcepto(idIncapacidad, dia, por) {
      const filas = comprobar(
        await cliente
          .from('incapacidad')
          .update({ falta_concepto: true, fecha_falta_concepto: ahora(), falta_concepto_por: por })
          .eq('id', idIncapacidad)
          .eq('falta_concepto', false)
          .is('concepto', null)
          .lte(columnaDelDia(dia.n), dia.hoy)
          .eq('tiene_prorroga', false)
          .select('id'),
      );
      return filas.length === 1;
    },

    /** Deshace la falta recién guardada (si el aviso falló). */
    async deshacerFaltaConcepto(idIncapacidad) {
      comprobar(
        await cliente
          .from('incapacidad')
          .update({ falta_concepto: false, fecha_falta_concepto: null, falta_concepto_por: null })
          .eq('id', idIncapacidad)
          .is('concepto', null),
      );
    },

    /**
     * DS-10: guardarSuspensionPago() — HU-24. Solo si ya llegó al día 181 (`dia`, como en guardarConcepto) y no estaba
     * suspendido. @returns {Promise<boolean>} false si el estado ya no lo permitía.
     */
    async guardarSuspensionPago(idIncapacidad, dia, por) {
      const filas = comprobar(
        await cliente
          .from('incapacidad')
          .update({ pago_suspendido: true, fecha_suspension: ahora(), suspension_por: por })
          .eq('id', idIncapacidad)
          .eq('pago_suspendido', false)
          .lte(columnaDelDia(dia.n), dia.hoy)
          .eq('tiene_prorroga', false)
          .select('id'),
      );
      return filas.length === 1;
    },

    /** Deshace la suspensión recién guardada (si el aviso falló). */
    async deshacerSuspensionPago(idIncapacidad) {
      comprobar(
        await cliente
          .from('incapacidad')
          .update({ pago_suspendido: false, fecha_suspension: null, suspension_por: null })
          .eq('id', idIncapacidad)
          .eq('pago_suspendido', true),
      );
    },
  };
}
