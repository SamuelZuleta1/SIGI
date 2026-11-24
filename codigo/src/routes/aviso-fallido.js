// Respuesta de las rutas cuando el correo de aviso falla después de guardar (ErrorDeAviso, Fase 1 de la
// auditoría de T-21 a T-24): si el registro se deshizo, el formulario vuelve con 502 y conserva lo escrito; si
// no se pudo deshacer, 500 con un mensaje que dice que el registro pudo quedar guardado sin aviso.

/** @param {string} destinatario con su preposición: «al colaborador», «a Cartera y Jurídica». */
export const mensajeAvisoFallido = (destinatario) => `No se pudo avisar ${destinatario}; no se guardó nada. Intente de nuevo.`;

/**
 * @param {import('express').Response} res
 * @param {import('../controllers/error-de-aviso.js').ErrorDeAviso} error
 * @param {{ destinatario: string, volverAlFormulario: (estado: number, errores: object) => Promise<unknown> }} opciones
 */
export function responderAvisoFallido(res, error, { destinatario, volverAlFormulario }) {
  if (error.deshecho) return volverAlFormulario(502, { aviso: mensajeAvisoFallido(destinatario) });
  return res.status(500).pagina('error', {
    titulo: 'No se pudo completar el registro',
    mensaje:
      `El correo ${destinatario} falló y no se pudo deshacer el registro: pudo quedar guardado sin aviso. ` +
      `Abra la incapacidad n.º ${error.idIncapacidad} para comprobarlo y avise por otro medio.`,
  });
}
