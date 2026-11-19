// Grupo `registro` del Control de incapacidades — DS-01 (CU-01, CU-02).
// Operaciones: registrarIncapacidad, registrarDocumentos.
// Apoyo: obtenerEntidades, para que el formulario ofrezca las entidades del seed (DA-03),
// y obtenerIncapacidad, para mostrar a cuál se le van a registrar los documentos.
import { z } from 'zod';
import { TIPOS_DOCUMENTO } from '../models/documento.model.js';
import { TIPOS_INCAPACIDAD } from '../models/incapacidad.model.js';
import { TAMANO_MAXIMO_ARCHIVO, tipoDeArchivo } from './archivo.js';
import { ErrorDeValidacion } from './error-de-validacion.js';
import { esIdentificador } from './identificador.js';

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

// Límites de la subida (el tamaño es el del bucket `documentos`; ver archivo.js).
export { TAMANO_MAXIMO_ARCHIVO };
export const MAXIMO_DOCUMENTOS = 10;

export function crearControlRegistro({ baseDeDatos, correo }) {
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

    /** Datos que identifican la incapacidad, o null si el número no corresponde a ninguna. */
    async obtenerIncapacidad(idIncapacidad) {
      return esIdentificador(idIncapacidad) ? baseDeDatos.consultarIncapacidad(Number(idIncapacidad)) : null;
    },

    /**
     * DS-01: registrarDocumentos(idIncapacidad, documentos).
     * `documentos` es una lista de { tipo, contenido: Buffer }.
     * - Recepción (personal receptor): guarda y avisa al auxiliar por correo (HU-04.CA1).
     * - Correo (auxiliar): guarda y marca el original en físico como pendiente, sin aviso (HU-04.CA2).
     * El canal sale del rol: en DA-02 el auxiliar solo registra documentos cuando llegan por correo.
     * @returns {Promise<{ idIncapacidad: number, cantidad: number, originalPendiente: boolean, avisoEnviado: boolean }>}
     */
    async registrarDocumentos(idIncapacidad, documentos, usuario) {
      const incapacidad = await this.obtenerIncapacidad(idIncapacidad);
      if (!incapacidad) throw new ErrorDeValidacion({ incapacidad: 'No hay una incapacidad con ese número.' });

      const lista = Array.isArray(documentos) ? documentos : [];
      const errores = {};
      if (lista.length === 0) errores.documentos = 'Adjunte al menos un documento.';
      else if (lista.length > MAXIMO_DOCUMENTOS) errores.documentos = `Adjunte máximo ${MAXIMO_DOCUMENTOS} documentos a la vez.`;

      const validos = [];
      lista.forEach((documento, posicion) => {
        const contenido = documento?.contenido;
        const tipoMime = Buffer.isBuffer(contenido) ? tipoDeArchivo(contenido) : null;
        const clave = `documento${posicion}`;
        if (!TIPOS_DOCUMENTO.includes(documento?.tipo)) errores[clave] = 'Elija el tipo de documento.';
        else if (!Buffer.isBuffer(contenido) || contenido.length === 0) errores[clave] = 'Adjunte el archivo.';
        else if (contenido.length > TAMANO_MAXIMO_ARCHIVO) errores[clave] = 'El archivo pesa más de 10 MB.';
        else if (!tipoMime) errores[clave] = 'El archivo debe ser PDF, JPG o PNG.';
        else validos.push({ tipo: documento.tipo, contenido, tipoMime });
      });
      if (Object.keys(errores).length > 0) throw new ErrorDeValidacion(errores);

      // Por correo, los documentos y la marca de original pendiente se guardan juntos o no se guarda nada.
      const porCorreo = usuario.rol === 'auxiliar';
      await baseDeDatos.guardarDocumentos(incapacidad.idIncapacidad, validos, usuario.id, { originalPendiente: porCorreo });

      let avisoEnviado = false;
      if (!porCorreo) {
        // Los documentos ya quedaron guardados: si el correo falla, se advierte y no se pierde el registro.
        try {
          await correo.notificarRecepcion(incapacidad);
          avisoEnviado = true;
        } catch (error) {
          console.error('No se pudo enviar notificarRecepcion:', error);
        }
      }
      return { idIncapacidad: incapacidad.idIncapacidad, cantidad: validos.length, originalPendiente: porCorreo, avisoEnviado };
    },
  };
}
