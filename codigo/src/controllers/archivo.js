// Archivos que se suben al bucket privado `documentos` (HU-04, HU-10): límites y tipo por contenido.
// Lo comparten los grupos `registro`, `radicacion` y `seguimiento`.

// Tamaño máximo: el mismo del bucket `documentos` (migración inicial).
export const TAMANO_MAXIMO_ARCHIVO = 10 * 1024 * 1024;

// El tipo de archivo se decide por su contenido, no por lo que diga el navegador.
const FIRMAS = [
  ['application/pdf', [0x25, 0x50, 0x44, 0x46, 0x2d]], // %PDF-
  ['image/jpeg', [0xff, 0xd8, 0xff]],
  ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
];

/** Tipo MIME (PDF, JPG o PNG) según los primeros bytes, o null si no es ninguno. */
export const tipoDeArchivo = (contenido) =>
  FIRMAS.find(([, firma]) => firma.every((byte, i) => contenido[i] === byte))?.[0] ?? null;

/**
 * Valida una evidencia (P-D): obligatoria, de 10 MB como máximo y PDF, JPG o PNG por su contenido.
 * @param {unknown} contenido Buffer recibido.
 * @param {string} faltante mensaje si no se adjuntó.
 * @returns {{ tipoMime?: string, error?: string }}
 */
export function leerEvidencia(contenido, faltante) {
  if (!Buffer.isBuffer(contenido) || contenido.length === 0) return { error: faltante };
  if (contenido.length > TAMANO_MAXIMO_ARCHIVO) return { error: 'El archivo pesa más de 10 MB.' };
  const tipoMime = tipoDeArchivo(contenido);
  return tipoMime ? { tipoMime } : { error: 'La evidencia debe ser PDF, JPG o PNG.' };
}
