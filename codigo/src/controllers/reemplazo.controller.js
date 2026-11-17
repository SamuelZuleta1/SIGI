// Grupo `reemplazo` del Control de incapacidades — DS-02 (CU-03).
// Operación: registrarReemplazo.
// Apoyo: obtenerReemplazo, para mostrar la incapacidad y el reemplazo que ya tiene.
import { z } from 'zod';
import { ErrorDeValidacion } from './error-de-validacion.js';
import { esIdentificador } from './identificador.js';

const nombreDelReemplazo = z
  .string({ error: 'Escriba el nombre de quien reemplaza.' })
  .trim()
  .min(1, 'Escriba el nombre de quien reemplaza.')
  .max(200, 'El nombre es demasiado largo.');

export function crearControlReemplazo({ baseDeDatos }) {
  const buscar = async (idIncapacidad) =>
    esIdentificador(idIncapacidad) ? baseDeDatos.consultarIncapacidad(Number(idIncapacidad)) : null;

  return {
    /**
     * La incapacidad y su reemplazo actual (null si no tiene), o null si el número no corresponde a ninguna.
     * @returns {Promise<{ incapacidad: object, reemplazo: string | null } | null>}
     */
    async obtenerReemplazo(idIncapacidad) {
      const incapacidad = await buscar(idIncapacidad);
      if (!incapacidad) return null;
      return { incapacidad, reemplazo: await baseDeDatos.consultarReemplazo(incapacidad.idIncapacidad) };
    },

    /**
     * DS-02: registrarReemplazo(idIncapacidad, reemplazo).
     * Guarda quién reemplaza al colaborador, asociado a la incapacidad (HU-05.CA1).
     * Si la incapacidad ya tenía un reemplazo, el nuevo lo sustituye (HU-05.CA2, DA-22).
     * @returns {Promise<{ idIncapacidad: number, reemplazo: string }>}
     */
    async registrarReemplazo(idIncapacidad, reemplazo, usuario) {
      const incapacidad = await buscar(idIncapacidad);
      if (!incapacidad) throw new ErrorDeValidacion({ incapacidad: 'No hay una incapacidad con ese número.' });

      const resultado = nombreDelReemplazo.safeParse(reemplazo);
      if (!resultado.success) throw new ErrorDeValidacion({ reemplazo: resultado.error.issues[0].message });

      await baseDeDatos.guardarReemplazo(incapacidad.idIncapacidad, resultado.data, usuario.id);
      return { idIncapacidad: incapacidad.idIncapacidad, reemplazo: resultado.data };
    },
  };
}
