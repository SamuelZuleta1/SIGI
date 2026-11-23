// Error de los controladores cuando el correo de aviso falla después de guardar (DA-44, DA-47, DA-48).
// `deshecho` dice si el registro se pudo deshacer: si es true no quedó nada guardado y se puede reintentar
// (la ruta responde 502 y conserva lo escrito); si es false, el registro pudo quedar guardado sin aviso (500).
// `cause` es el error original del correo.
export class ErrorDeAviso extends Error {
  constructor({ operacion, idIncapacidad, deshecho, causa }) {
    super(`No se pudo enviar el aviso de ${operacion} (incapacidad n.º ${idIncapacidad})`, { cause: causa });
    this.name = 'ErrorDeAviso';
    this.operacion = operacion;
    this.idIncapacidad = idIncapacidad;
    this.deshecho = deshecho;
  }
}

// Lo que se registra de un error: sin el objeto completo (nodemailer adjunta el sobre con los destinatarios) y con
// las direcciones de correo del mensaje ocultas.
const CORREO = /[^\s<>"'@]+@[^\s<>"'@]+\.[^\s<>"'@]+/g;
export const resumirError = (error) => ({
  nombre: error?.name,
  codigo: error?.code ?? error?.responseCode,
  mensaje: String(error?.message ?? error).replace(CORREO, '<correo>'),
});

/**
 * Envía el aviso de algo recién guardado; si falla, lo deshace. Nunca pierde el error del correo: va como `cause`
 * del ErrorDeAviso. Si el deshacer también falla, lo deja en el registro del servidor con su contexto.
 * @param {{ operacion: string, idIncapacidad: number, avisar: () => Promise<unknown>, deshacer: () => Promise<unknown> }} pasos
 * @throws {ErrorDeAviso}
 */
export async function avisarODeshacer({ operacion, idIncapacidad, avisar, deshacer }) {
  try {
    await avisar();
  } catch (errorCorreo) {
    let deshecho = true;
    try {
      await deshacer();
    } catch (errorDeshacer) {
      deshecho = false;
      console.error(`[${operacion}] El aviso falló y no se pudo deshacer el registro`, {
        idIncapacidad,
        errorCorreo: resumirError(errorCorreo),
        errorDeshacer: resumirError(errorDeshacer),
      });
    }
    if (deshecho) console.error(`[${operacion}] El aviso falló; se deshizo el registro`, { idIncapacidad, errorCorreo: resumirError(errorCorreo) });
    throw new ErrorDeAviso({ operacion, idIncapacidad, deshecho, causa: errorCorreo });
  }
}
