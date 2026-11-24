// Salario mínimo mensual legal vigente por año (DA-51), en pesos. Sirve para advertir un IBC por debajo de 1 SMMLV o
// por encima de 25 SMMLV (tope de cotización); no bloquea el cálculo. Se actualiza cada año, como los festivos.
//   2025: Decreto 1572 de 2024.
//   2026: Decreto 0159 de 2026 (fija transitoriamente el valor; el Decreto 1469 de 2025 quedó sin efecto).
export const SMMLV = Object.freeze({
  2025: 1_423_500,
  2026: 1_750_905,
});

export const IBC_MINIMO_SMMLV = 1;
export const IBC_MAXIMO_SMMLV = 25;

/**
 * SMMLV del año pedido; si aún no está en la lista, el del año más cercano que sí esté (se dice cuál).
 * @param {number} anio
 * @returns {{ anio: number, valor: number }}
 */
export function smmlvDe(anio) {
  const anios = Object.keys(SMMLV).map(Number).sort((a, b) => a - b);
  const usado = anios.findLast((a) => a <= anio) ?? anios[0];
  return { anio: usado, valor: SMMLV[usado] };
}

/**
 * Advertencia del IBC frente al SMMLV del año de inicio de la incapacidad (DA-51), o null si está en el rango.
 * @param {number} ibcCentavos
 * @param {string} fechaInicio AAAA-MM-DD
 * @returns {null | { tipo: 'bajo' | 'alto', anio: number, limite: number }} `limite` en pesos.
 */
export function advertenciaIbc(ibcCentavos, fechaInicio) {
  const { anio, valor } = smmlvDe(Number(fechaInicio.slice(0, 4)));
  if (ibcCentavos < valor * IBC_MINIMO_SMMLV * 100) return { tipo: 'bajo', anio, limite: valor * IBC_MINIMO_SMMLV };
  if (ibcCentavos > valor * IBC_MAXIMO_SMMLV * 100) return { tipo: 'alto', anio, limite: valor * IBC_MAXIMO_SMMLV };
  return null;
}
