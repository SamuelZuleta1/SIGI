// «Base de datos» (Persistencia, CL-01): índice que compone los 14 grupos.
// Los grupos se agregan módulo por módulo.
import { crearClienteServidor } from '../config/supabase.js';
import { crearPersistenciaEstados } from './estados.persistence.js';
import { crearPersistenciaRadicacion } from './radicacion.persistence.js';
import { crearPersistenciaReemplazo } from './reemplazo.persistence.js';
import { crearPersistenciaRegistro } from './registro.persistence.js';
import { crearPersistenciaVerificacion } from './verificacion.persistence.js';

export function crearBaseDeDatos(cliente = crearClienteServidor()) {
  return {
    ...crearPersistenciaRegistro(cliente),
    ...crearPersistenciaReemplazo(cliente),
    ...crearPersistenciaVerificacion(cliente),
    ...crearPersistenciaRadicacion(cliente),
    ...crearPersistenciaEstados(cliente),
  };
}
