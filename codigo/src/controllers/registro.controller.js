// Grupo `registro` del Control de incapacidades — DS-01 (CU-01, CU-02).
// Operaciones: registrarIncapacidad. (registrarDocumentos llega con HU-04.)
// Apoyo: obtenerEntidades, para que el formulario ofrezca las entidades del seed (DA-03).
import { z } from 'zod';
import { TIPOS_INCAPACIDAD } from '../models/incapacidad.model.js';
import { ErrorDeValidacion } from './error-de-validacion.js';

const fecha = (mensaje) => z.string({ error: mensaje }).pipe(z.iso.date({ error: mensaje }));

// Contenido mínimo del registro (CU-01, HU-03.CA1) + correo del colaborador (DA-04).
// El IBC no se pide aquí: se ingresa al calcular el reconocimiento (HU-21.CA3).
const datosDeIncapacidad = z.object({
  colaborador: z
    .string({ error: 'Escriba el nombre del colaborador.' })
    .trim()
    .min(1, 'Escriba el nombre del colaborador.')
    .max(200, 'El nombre es demasiado largo.'),
  correoColaborador: z
    .string({ error: 'Escriba el correo del colaborador.' })
    .trim()
    .toLowerCase()
    .max(200, 'El correo es demasiado largo.')
    .pipe(z.email({ error: 'Escriba un correo válido, por ejemplo nombre@empresa.com.' })),
  tipo: z.enum(TIPOS_INCAPACIDAD, { error: 'Elija el tipo de incapacidad o licencia.' }),
  entidad: z.coerce
    .number({ error: 'Elija la entidad (EPS o ARL).' })
    .int('Elija la entidad (EPS o ARL).')
    .positive('Elija la entidad (EPS o ARL).'),
  fechaInicio: fecha('Escriba la fecha de inicio.'),
  // El tope es técnico (cabe en un entero de la base de datos), no una regla del negocio.
  diasIncapacidad: z.coerce
    .number({ error: 'Escriba los días de incapacidad.' })
    .int('Los días deben ser un número entero.')
    .min(1, 'Los días deben ser 1 o más.')
    .max(9999, 'Revise los días de incapacidad.'),
  fechaRecepcion: fecha('Escriba la fecha de recepción.'),
});

export function crearControlRegistro({ baseDeDatos }) {
  return {
    /** Entidades (EPS y ARL) entre las que se elige al registrar (DA-03). */
    obtenerEntidades() {
      return baseDeDatos.consultarEntidades();
    },

    /**
     * DS-01: registrarIncapacidad(colaborador, tipo, entidad, fechaInicio, dias, fechaRecepcion).
     * Crea el colaborador si no existe (DA-03) y guarda quién registró (DA-23).
     * La incapacidad queda sin estado: «registrada, sin transcribir» (HU-03.CA4, EST-01).
     * @returns {Promise<{ idIncapacidad: number }>}
     */
    async registrarIncapacidad(datos, usuario) {
      const resultado = datosDeIncapacidad.safeParse(datos ?? {});
      const errores = {};
      if (!resultado.success) {
        for (const problema of resultado.error.issues) errores[problema.path[0]] ??= problema.message;
      } else {
        const entidades = await baseDeDatos.consultarEntidades();
        if (!entidades.some((e) => e.id === resultado.data.entidad)) errores.entidad = 'Elija una entidad de la lista.';
      }
      if (Object.keys(errores).length > 0) throw new ErrorDeValidacion(errores);

      const { colaborador, correoColaborador, entidad, ...resto } = resultado.data;
      const idIncapacidad = await baseDeDatos.guardarIncapacidad(
        { colaborador: { nombre: colaborador, correo: correoColaborador }, entidad, ...resto },
        usuario.id,
      );
      return { idIncapacidad };
    },
  };
}
