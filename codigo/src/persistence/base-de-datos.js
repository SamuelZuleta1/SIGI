// «Base de datos» (Persistencia, CL-01): índice que compone los 14 grupos.
// Los grupos se agregan módulo por módulo.
import { crearClienteServidor } from '../config/supabase.js';
import { crearPersistenciaRegistro } from './registro.persistence.js';

export function crearBaseDeDatos(cliente = crearClienteServidor()) {
  return {
    ...crearPersistenciaRegistro(cliente),
  };
}
