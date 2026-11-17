// «Control de incapacidades» (Controlador, CL-01): índice que compone los 14 grupos.
// Los grupos se agregan módulo por módulo.
import { crearControlReemplazo } from './reemplazo.controller.js';
import { crearControlRegistro } from './registro.controller.js';
import { crearControlVerificacion } from './verificacion.controller.js';

/** @param {{ baseDeDatos: object, correo: object }} dependencias */
export function crearControlIncapacidades(dependencias) {
  return {
    ...crearControlRegistro(dependencias),
    ...crearControlReemplazo(dependencias),
    ...crearControlVerificacion(dependencias),
  };
}
