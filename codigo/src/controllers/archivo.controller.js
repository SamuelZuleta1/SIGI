// Grupo `archivo` del Control de incapacidades — DS-13 (CU-17).
// Operaciones: consultarPagadas → obtenerPagadas (HU-29.CA1), prepararArchivo (apoyo de la Vista) y
// archivarIncapacidad → obtenerEstadoPago → eliminarEpicrisis → enviarParaArchivo → archivoPreparado (HU-29.CA2/CA3) y
// registrarEnvioArchivo → guardarEnvio: la entrega de los documentos físicos, fin del ciclo (HU-30, DA-60).
import { aCentavos, centavosATexto } from '../servicios/moneda.js';
import { avisarODeshacer, resumirError } from './error-de-aviso.js';
import { ErrorDeValidacion } from './error-de-validacion.js';
import { esIdentificador } from './identificador.js';

// Pestañas de la lista (DA-59, DA-60): «Por archivar» va primero y es la de por defecto; «Enviadas» guarda el historial.
export const PESTANAS_ARCHIVO = Object.freeze(['por_archivar', 'sin_conciliar', 'preparado', 'enviada']);

// «Enviadas» es un historial que solo crece: se muestran las más recientes (por fecha de envío) hasta este tope.
export const LIMITE_ENVIADAS = 200;

/**
 * DS-13: obtenerEstadoPago(idIncapacidad) — DA-11: el pago está identificado y conciliado cuando la incapacidad tiene al
 * menos un pago y todos sus pagos se identificaron en una conciliación (HU-26).
 */
export const pagoConciliado = (i) => i.pagos.length > 0 && i.pagos.every((p) => p.conciliado);

/** En qué punto del archivo está una pagada: enviada a Gestión Documental (fin del ciclo), preparada o por archivar. */
export const situacionArchivo = (i) => {
  if (i.enviadaAGestionDocumental) return 'enviada';
  if (i.fechaArchivoPreparado != null) return 'preparado';
  return pagoConciliado(i) ? 'por_archivar' : 'sin_conciliar';
};

/**
 * No se pudo eliminar la epicrisis al archivar (DA-59). `deshecho`: si se quitó la marca de archivo preparado (se puede
 * reintentar); si es false, la incapacidad pudo quedar marcada sin avisar a Gestión Documental. `cause`: el error original.
 */
export class ErrorAlEliminarEpicrisis extends Error {
  constructor({ idIncapacidad, deshecho, causa }) {
    super(`No se pudo eliminar la epicrisis (incapacidad n.º ${idIncapacidad})`, { cause: causa });
    this.name = 'ErrorAlEliminarEpicrisis';
    this.idIncapacidad = idIncapacidad;
    this.deshecho = deshecho;
  }
}

export const MENSAJE_SIN_CONCILIAR =
  'El pago de esta incapacidad aún no está identificado y conciliado: no se puede archivar. ' +
  'Concílielo primero con los pagos consignados de la entidad (menú «Conciliación»).';

export const MENSAJE_SIN_ENTREGA = 'Marque la casilla para confirmar que entregó los documentos físicos a Gestión Documental.';

/** HU-30: por qué no se puede registrar el envío. */
const mensajeEnvio = (i) => {
  if (i.estado !== 'pagada') return 'Solo se registra el envío de las incapacidades pagadas.';
  if (i.enviadaAGestionDocumental) return 'El envío de esta incapacidad a Gestión Documental ya está registrado.';
  if (i.fechaArchivoPreparado == null) return 'Primero archive la incapacidad: el archivo aún no está preparado.';
  return 'La incapacidad no admite registrar el envío ahora. Revise sus datos.';
};

const mensajeEstado = (i) => {
  if (i.estado !== 'pagada') return 'Solo se archivan las incapacidades pagadas.';
  if (i.enviadaAGestionDocumental) return 'Esta incapacidad ya se envió a Gestión Documental.';
  if (i.fechaArchivoPreparado != null) return 'El archivo de esta incapacidad ya está preparado.';
  if (!pagoConciliado(i)) return MENSAJE_SIN_CONCILIAR;
  return 'La incapacidad no admite archivarse ahora. Revise sus datos.';
};

/** Lo que la Vista necesita saber de una pagada. */
const conSituacion = (i) => ({
  ...i,
  situacion: situacionArchivo(i),
  totalPagado: centavosATexto(i.pagos.reduce((total, p) => total + aCentavos(p.valor), 0)),
  pagosSinConciliar: i.pagos.filter((p) => !p.conciliado).length,
  tieneEpicrisis: i.documentos.some((d) => d.tipo === 'epicrisis'),
});

export function crearControlArchivo({ baseDeDatos, correo }) {
  const leer = (id) => (esIdentificador(id) ? baseDeDatos.obtenerDatosArchivo(Number(id)) : null);

  return {
    /**
     * DS-13: consultarPagadas() → obtenerPagadas() → listaPagadas — HU-29.CA1. Las pagadas aún sin enviar a Gestión
     * Documental, separadas por su situación. Las ya enviadas (DA-60) solo se cuentan, y se leen (las LIMITE_ENVIADAS
     * más recientes) únicamente en su pestaña. Solo consulta.
     * @param {string} ver pestaña: por_archivar, sin_conciliar, preparado o enviada (otra cosa = por_archivar).
     * @returns {Promise<{ ver: string, pagadas: object[], conteos: object, limitado: boolean, limite: number }>}
     */
    async consultarPagadas(ver = 'por_archivar') {
      const pestana = PESTANAS_ARCHIVO.includes(ver) ? ver : 'por_archivar';
      const [pendientes, totalEnviadas, enviadas] = await Promise.all([
        baseDeDatos.obtenerPagadas().then((filas) => filas.map(conSituacion)),
        baseDeDatos.contarEnviadas(),
        pestana === 'enviada' ? baseDeDatos.obtenerEnviadas(LIMITE_ENVIADAS).then((filas) => filas.map(conSituacion)) : [],
      ]);
      const conteos = Object.fromEntries(PESTANAS_ARCHIVO.map((clave) => [clave, pendientes.filter((i) => i.situacion === clave).length]));
      conteos.enviada = totalEnviadas;
      return {
        ver: pestana,
        pagadas: pestana === 'enviada' ? enviadas : pendientes.filter((i) => i.situacion === pestana),
        conteos,
        limitado: pestana === 'enviada' && totalEnviadas > enviadas.length,
        limite: LIMITE_ENVIADAS,
      };
    },

    /** Datos de la pantalla de archivo de una incapacidad. Solo consulta. null si no existe o no está pagada. */
    async prepararArchivo(idIncapacidad) {
      const incapacidad = await leer(idIncapacidad);
      if (!incapacidad || incapacidad.estado !== 'pagada') return null;
      return conSituacion(incapacidad);
    },

    /**
     * DS-13: archivarIncapacidad(idIncapacidad) — HU-29.CA2/CA3. Solo si el pago está identificado y conciliado (DA-11);
     * si no, advierte y no envía nada (CA3). Orden (DA-59): (1) marca el archivo preparado en una transacción que vuelve
     * a comprobar el pago; (2) elimina la epicrisis (DA-12); (3) envía los datos a Gestión Documental, sin adjuntos
     * (DA-12). Si (2) o (3) fallan, se quita la marca y se puede reintentar; la epicrisis que ya se eliminó no vuelve
     * (CAR-11: se elimina al identificar el pago).
     * @param {{ id: string }} usuario quien archiva (DA-23).
     * @returns {Promise<null | { idIncapacidad: number, epicrisisEliminadas: number }>} null si no existe.
     * @throws {ErrorDeValidacion} no está pagada, ya se preparó o el pago no está conciliado (`estado`).
     * @throws {ErrorAlEliminarEpicrisis} no se pudo eliminar la epicrisis (no se envió el correo).
     * @throws {import('./error-de-aviso.js').ErrorDeAviso} el correo a Gestión Documental falló.
     */
    async archivarIncapacidad(idIncapacidad, usuario) {
      const actual = await leer(idIncapacidad);
      if (!actual) return null;
      // mensajeEstado explica cuál de las condiciones falta (no pagada, ya enviada, ya preparada o sin conciliar).
      if (actual.estado !== 'pagada' || actual.enviadaAGestionDocumental || situacionArchivo(actual) !== 'por_archivar') {
        throw new ErrorDeValidacion({ estado: mensajeEstado(actual) });
      }

      const guardado = await baseDeDatos.guardarArchivoPreparado(actual.idIncapacidad, usuario.id);
      if (!guardado) {
        const ahora = await leer(actual.idIncapacidad);
        throw new ErrorDeValidacion({ estado: ahora ? mensajeEstado(ahora) : 'La incapacidad ya no existe.' });
      }

      let epicrisisEliminadas;
      try {
        epicrisisEliminadas = await baseDeDatos.eliminarEpicrisis(actual.idIncapacidad);
      } catch (error) {
        let deshecho = true;
        try {
          await baseDeDatos.deshacerArchivoPreparado(actual.idIncapacidad);
        } catch (errorDeshacer) {
          deshecho = false;
          console.error('[archivarIncapacidad] No se pudo quitar la marca de archivo preparado', {
            idIncapacidad: actual.idIncapacidad,
            errorDeshacer: resumirError(errorDeshacer),
          });
        }
        console.error('[archivarIncapacidad] No se pudo eliminar la epicrisis', { idIncapacidad: actual.idIncapacidad, error: resumirError(error), deshecho });
        throw new ErrorAlEliminarEpicrisis({ idIncapacidad: actual.idIncapacidad, deshecho, causa: error });
      }

      const documentos = actual.documentos.filter((d) => d.tipo !== 'epicrisis').map((d) => d.tipo);
      await avisarODeshacer({
        operacion: 'archivarIncapacidad',
        idIncapacidad: actual.idIncapacidad,
        avisar: () =>
          correo.enviarParaArchivo({ ...actual, totalPagado: conSituacion(actual).totalPagado }, { documentos, epicrisisEliminadas }),
        deshacer: () => baseDeDatos.deshacerArchivoPreparado(actual.idIncapacidad),
      });
      return { idIncapacidad: actual.idIncapacidad, epicrisisEliminadas };
    },

    /**
     * DS-13: registrarEnvioArchivo(idIncapacidad) → guardarEnvio(idIncapacidad) — HU-30.CA1. El auxiliar confirma que
     * entregó los documentos físicos; con el archivo preparado (HU-29) la incapacidad queda enviada a Gestión
     * Documental, con quién y cuándo (DA-23): estado final del ciclo. No envía correos (el aviso salió en HU-29).
     * @param {{ entregado?: boolean }} datos la casilla «Entregué los documentos físicos».
     * @param {{ id: string }} usuario quien registra (DA-23).
     * @returns {Promise<null | { idIncapacidad: number }>} null si no existe.
     * @throws {ErrorDeValidacion} falta la casilla (`entregado`) o el estado no lo permite (`estado`).
     */
    async registrarEnvioArchivo(idIncapacidad, { entregado } = {}, usuario) {
      const actual = await leer(idIncapacidad);
      if (!actual) return null;
      if (situacionArchivo(actual) !== 'preparado' || actual.estado !== 'pagada') {
        throw new ErrorDeValidacion({ estado: mensajeEnvio(actual) });
      }
      if (entregado !== true) throw new ErrorDeValidacion({ entregado: MENSAJE_SIN_ENTREGA });

      if (!(await baseDeDatos.guardarEnvio(actual.idIncapacidad, usuario.id))) {
        const ahora = await leer(actual.idIncapacidad);
        throw new ErrorDeValidacion({ estado: ahora ? mensajeEnvio(ahora) : 'La incapacidad ya no existe.' });
      }
      return { idIncapacidad: actual.idIncapacidad };
    },
  };
}
