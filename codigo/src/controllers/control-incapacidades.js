// «Control de incapacidades» (Controlador, CL-01): índice que compone los 14 grupos.
// Los grupos se agregan módulo por módulo.
import { crearControlRegistro } from './registro.controller.js';

/** @param {{ baseDeDatos: object, correo: object }} dependencias */
export function crearControlIncapacidades(dependencias) {
  return {
    ...crearControlRegistro(dependencias),
  };
}
