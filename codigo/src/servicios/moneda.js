// Valores en pesos colombianos (HU-15, DA-40). El dinero se maneja en centavos enteros para no
// perder precisión con los decimales de JavaScript; a la base de datos va como texto «1234567.50».

const SIN_CENTAVOS = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const CON_CENTAVOS = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Centavos enteros → texto para numeric(14,2): 123456750 → «1234567.50». */
export const centavosATexto = (centavos) => `${Math.trunc(centavos / 100)}.${String(centavos % 100).padStart(2, '0')}`;

/** Número o texto «1234567.50» (de la base de datos) → centavos enteros. */
export const aCentavos = (valor) => Math.round(Number(valor) * 100);

/** «$ 1.234.567» o, si tiene centavos, «$ 1.234.567,50». Recibe un número o el texto «1234567.50». */
export const pesos = (valor) => {
  const centavos = aCentavos(valor);
  return (centavos % 100 === 0 ? SIN_CENTAVOS : CON_CENTAVOS).format(centavos / 100).replace(/ /g, ' ');
};
