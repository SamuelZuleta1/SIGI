// «Base de datos» (Persistencia, CL-01): índice que compone los 14 grupos.
// Los grupos se agregan módulo por módulo.
import { crearClienteServidor } from '../config/supabase.js';
import { crearPersistenciaAlertas } from './alertas.persistence.js';
import { crearPersistenciaArchivo } from './archivo.persistence.js';
import { crearPersistenciaCobro } from './cobro.persistence.js';
import { crearPersistenciaConciliacion } from './conciliacion.persistence.js';
import { crearPersistenciaCobroJuridico } from './cobro-juridico.persistence.js';
import { crearPersistenciaEstadisticas } from './estadisticas.persistence.js';
import { crearPersistenciaEstados } from './estados.persistence.js';
import { crearPersistenciaMonitoreo } from './monitoreo.persistence.js';
import { crearPersistenciaRadicacion } from './radicacion.persistence.js';
import { crearPersistenciaReconocimiento } from './reconocimiento.persistence.js';
import { crearPersistenciaReemplazo } from './reemplazo.persistence.js';
import { crearPersistenciaReportes } from './reportes.persistence.js';
import { crearPersistenciaSeguimiento } from './seguimiento.persistence.js';
import { crearPersistenciaSubidas } from './subidas.persistence.js';
import { crearPersistenciaRegistro } from './registro.persistence.js';
import { crearPersistenciaVerificacion } from './verificacion.persistence.js';

export function crearBaseDeDatos(cliente = crearClienteServidor()) {
  return {
    ...crearPersistenciaRegistro(cliente),
    ...crearPersistenciaReemplazo(cliente),
    ...crearPersistenciaVerificacion(cliente),
    ...crearPersistenciaRadicacion(cliente),
    ...crearPersistenciaEstados(cliente),
    ...crearPersistenciaAlertas(cliente),
    ...crearPersistenciaCobro(cliente),
    ...crearPersistenciaSeguimiento(cliente),
    ...crearPersistenciaCobroJuridico(cliente),
    ...crearPersistenciaReconocimiento(cliente),
    ...crearPersistenciaMonitoreo(cliente),
    ...crearPersistenciaConciliacion(cliente),
    ...crearPersistenciaReportes(cliente),
    ...crearPersistenciaEstadisticas(cliente),
    ...crearPersistenciaArchivo(cliente),
    ...crearPersistenciaSubidas(cliente),
  };
}
