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

/** Fecha calendario (AAAA-MM-DD) del día N de la incapacidad: inicio + N − 1. */
export const fechaDelDia = (fechaInicio, n) => sumarIntervalo(fechaInicio, { dias: n - 1 });

/**
 * DA-49: la incapacidad llegó al día N si dura N días o más y ese día ya se cumplió (`fechaDelDia <= hoy`).
 * @param {{ fechaInicio: string, diasIncapacidad: number }} i
 */
export const llegoAlDia = (i, n, hoy) => i.diasIncapacidad >= n && fechaDelDia(i.fechaInicio, n) <= hoy;

/**
 * La misma regla para la escritura condicionada de la base: `dias_incapacidad >= n` y `fecha_inicio <= inicioHasta`.
 * @returns {{ dias: number, inicioHasta: string }}
 */
export const condicionDelDia = (n, hoy) => ({ dias: n, inicioHasta: sumarIntervalo(hoy, { dias: -(n - 1) }) });

/** Día de la incapacidad en que va hoy: 0 si aún no empieza; como máximo, su duración. */
export const diaActual = (i, hoy) => Math.min(i.diasIncapacidad, Math.max(0, diasCalendario(i.fechaInicio, hoy) + 1));
