// Hitos de las incapacidades prolongadas (CAR-07, DA-13, DA-37, DA-49): único origen de la regla del día N para
// las alertas (HU-12) y el monitoreo (HU-22 a HU-24). El día 1 es `fechaInicio`.
import { diasCalendario, sumarIntervalo } from '../servicios/dias-habiles.js';

export const HITOS = Object.freeze([90, 120, 150, 180]);

// HU-22: «prolongada» es la de más de 90 días; el concepto de rehabilitación se pide el día 120; el concepto va a la
// AFP antes del día 150; más de 180 días (desde el día 181): suspensión del pago y trámite de pensión.
export const DIAS_PROLONGADA = 90;
export const DIA_CONCEPTO = 120;
export const DIA_AFP = 150;
export const DIA_SUSPENSION = 180;
export const DIA_PENSION = DIA_SUSPENSION + 1;

// Días del caso con fecha guardada en la base (columnas fecha_dia_N de la migración de prórrogas, DA-50).
export const DIAS_CON_FECHA = Object.freeze([...HITOS, DIA_PENSION]);

/** Días del caso: los de este certificado más los de sus anteriores (DA-50). Sin prórrogas, los del certificado. */
export const diasDelCaso = (i) => i.diasAcumulados ?? (i.diasPrevios ?? 0) + i.diasIncapacidad;

/**
 * Fecha calendario (AAAA-MM-DD) del día N del caso, o null si el caso no llega a ese día con los certificados
 * registrados. La guardada en la base (`fechasDia`) es exacta aunque haya interrupciones entre certificados; si no
 * viene, se calcula con este certificado: inicio + (N − días previos − 1), solo para los días que caen en él.
 * @param {{ fechaInicio: string, diasIncapacidad: number, diasPrevios?: number, fechasDia?: Record<number, string|null> }} i
 */
export function fechaDelDia(i, n) {
  if (i.fechasDia && Object.hasOwn(i.fechasDia, n)) return i.fechasDia[n];
  const previos = i.diasPrevios ?? 0;
  if (n <= previos || n > previos + i.diasIncapacidad) return null;
  return sumarIntervalo(i.fechaInicio, { dias: n - previos - 1 });
}

/**
 * Fechas del día N del caso para un certificado nuevo (como el trigger `incapacidad_derivados_del_caso`): los días que
 * caen en un certificado anterior se copian de él (`fechasAnterior`); los que caen en este, se calculan.
 */
export function fechasDelCaso({ fechaInicio, diasIncapacidad, diasPrevios = 0 }, fechasAnterior = {}) {
  return Object.fromEntries(
    DIAS_CON_FECHA.map((n) => [
      n,
      n <= diasPrevios
        ? (fechasAnterior[n] ?? null)
        : n <= diasPrevios + diasIncapacidad
          ? sumarIntervalo(fechaInicio, { dias: n - diasPrevios - 1 })
          : null,
    ]),
  );
}

/**
 * DA-49: el caso llegó al día N si dura N días o más y ese día ya se cumplió (`fechaDelDia <= hoy`).
 * @param {{ fechaInicio: string, diasIncapacidad: number }} i
 */
export const llegoAlDia = (i, n, hoy) => {
  if (diasDelCaso(i) < n) return false;
  const fecha = fechaDelDia(i, n);
  return fecha != null && fecha <= hoy;
};

/**
 * La misma regla para la escritura condicionada de la base: `fecha_dia_N <= hoy` (null no cumple) en el certificado
 * vigente del caso (`tiene_prorroga = false`). N debe ser uno de DIAS_CON_FECHA.
 * @returns {{ n: number, hoy: string }}
 */
export const condicionDelDia = (n, hoy) => {
  if (!DIAS_CON_FECHA.includes(n)) throw new Error(`El día ${n} no tiene fecha guardada en la base`);
  return { n, hoy };
};

/**
 * Día del caso en que va hoy: 0 si aún no empieza; como máximo, sus días. Si esta prórroga aún no empieza, los días
 * de los certificados anteriores.
 */
export const diaActual = (i, hoy) => {
  const previos = i.diasPrevios ?? 0;
  return previos + Math.min(i.diasIncapacidad, Math.max(0, diasCalendario(i.fechaInicio, hoy) + 1));
};
