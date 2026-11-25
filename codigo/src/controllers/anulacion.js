// Auditoría de las HU (pendientes): anular un pago (HU-15) o un pago consignado (HU-25) mal digitado, sin borrarlo.
// Regla compartida del motivo, como la causal del rechazo (DA-39) y el motivo del traslado (DA-44).

export const MOTIVO_ANULACION_MINIMO = 10;
export const MOTIVO_ANULACION_MAXIMO = 500;

/** Valida el motivo de la anulación. Cuenta caracteres, no unidades UTF-16. @returns {{ valor?: string, error?: string }} */
export function leerMotivoAnulacion(texto) {
  const limpio = typeof texto === 'string' ? texto.trim() : '';
  if (limpio === '') return { error: 'Escriba por qué se anula.' };
  const largo = [...limpio].length;
  if (largo < MOTIVO_ANULACION_MINIMO) return { error: `Escriba el motivo con al menos ${MOTIVO_ANULACION_MINIMO} caracteres.` };
  if (largo > MOTIVO_ANULACION_MAXIMO) return { error: `El motivo admite hasta ${MOTIVO_ANULACION_MAXIMO} caracteres.` };
  // Caracteres de control (salvo saltos de línea y tabulador): la base tampoco los admite.
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(limpio)) return { error: 'El motivo tiene caracteres no válidos.' };
  return { valor: limpio };
}
