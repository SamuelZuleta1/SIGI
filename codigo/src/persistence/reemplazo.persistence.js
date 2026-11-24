// Grupo `reemplazo` de la Base de datos — DS-02 (CU-03).
// Operación: guardarReemplazo.
// Apoyo: consultarReemplazo, para mostrar el reemplazo que ya tiene la incapacidad.
import { aFila } from './conversion.js';

const comprobar = ({ data, error }) => {
  if (error) throw error;
  return data;
};

export function crearPersistenciaReemplazo(cliente) {
  return {
    /** Nombre del reemplazo de la incapacidad, o null si no tiene. */
    async consultarReemplazo(idIncapacidad) {
      const fila = comprobar(
        await cliente.from('reemplazo').select('reemplazo').eq('incapacidad_id', idIncapacidad).maybeSingle(),
      );
      return fila?.reemplazo ?? null;
    },

    /**
     * DS-02: guardarReemplazo(idIncapacidad, reemplazo).
     * Una incapacidad tiene máximo un reemplazo (HU-05.CA2): si ya había uno, este lo sustituye (DA-22).
     * Es una sola sentencia sobre el índice único de `incapacidad_id`: dos registros simultáneos no dejan dos filas.
     */
    async guardarReemplazo(idIncapacidad, reemplazo, creadoPor) {
      comprobar(
        await cliente
          .from('reemplazo')
          .upsert(aFila({ incapacidadId: idIncapacidad, reemplazo, creadoPor }), { onConflict: 'incapacidad_id' }),
      );
    },
  };
}
