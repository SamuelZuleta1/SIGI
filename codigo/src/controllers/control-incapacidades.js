// «Control de incapacidades» (Controlador, CL-01): índice que compone los 14 grupos.
// Los grupos se agregan módulo por módulo.
import { crearControlAlertas } from './alertas.controller.js';
import { crearControlCobro } from './cobro.controller.js';
import { crearControlConciliacion } from './conciliacion.controller.js';
import { crearControlCobroJuridico } from './cobro-juridico.controller.js';
import { crearControlEstados } from './estados.controller.js';
import { crearControlMonitoreo } from './monitoreo.controller.js';
import { crearControlRadicacion } from './radicacion.controller.js';
import { crearControlReconocimiento } from './reconocimiento.controller.js';
import { crearControlReportes } from './reportes.controller.js';
import { crearControlReemplazo } from './reemplazo.controller.js';
import { crearControlRegistro } from './registro.controller.js';
import { crearControlSeguimiento } from './seguimiento.controller.js';
import { crearControlVerificacion } from './verificacion.controller.js';

/** @param {{ baseDeDatos: object, correo: object }} dependencias */
export function crearControlIncapacidades(dependencias) {
  return {
    ...crearControlRegistro(dependencias),
    ...crearControlReemplazo(dependencias),
    ...crearControlVerificacion(dependencias),
    ...crearControlRadicacion(dependencias),
    ...crearControlEstados(dependencias),
    ...crearControlAlertas(dependencias),
    ...crearControlCobro(dependencias),
    ...crearControlSeguimiento(dependencias),
    ...crearControlCobroJuridico(dependencias),
    ...crearControlReconocimiento(dependencias),
    ...crearControlMonitoreo(dependencias),
    ...crearControlConciliacion(dependencias),
    ...crearControlReportes(dependencias),
  };
}
