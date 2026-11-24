// Grupo `archivo` del Control de incapacidades — DS-13 (CU-17).
// Operaciones: consultarPagadas → obtenerPagadas (HU-29.CA1), prepararArchivo (apoyo de la Vista) y
// archivarIncapacidad → obtenerEstadoPago → eliminarEpicrisis → enviarParaArchivo → archivoPreparado (HU-29.CA2/CA3).
// El envío físico a Gestión Documental (registrarEnvioArchivo) es HU-30.
import { aCentavos, centavosATexto } from '../servicios/moneda.js';
import { avisarODeshacer, resumirError } from './error-de-aviso.js';
import { ErrorDeValidacion } from './error-de-validacion.js';
import { esIdentificador } from './identificador.js';

// Pestañas de la lista (DA-59): «Por archivar» va primero y es la de por defecto.
export const PESTANAS_ARCHIVO = Object.freeze(['por_archivar', 'sin_conciliar', 'preparado']);

/**
 * DS-13: obtenerEstadoPago(idIncapacidad) — DA-11: el pago está identificado y conciliado cuando la incapacidad tiene al
 * menos un pago y todos sus pagos se identificaron en una conciliación (HU-26).
 */
export const pagoConciliado = (i) => i.pagos.length > 0 && i.pagos.every((p) => p.conciliado);

/** En qué punto del archivo está una pagada que aún no se envió a Gestión Documental. */
export const situacionArchivo = (i) =>
  i.fechaArchivoPreparado != null ? 'preparado' : pagoConciliado(i) ? 'por_archivar' : 'sin_conciliar';

export const MENSAJE_SIN_CONCILIAR =
  'El pago de esta incapacidad aún no está identificado y conciliado: no se puede archivar. ' +
  'Concílielo primero con los pagos consignados de la entidad (menú «Conciliación»).';

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
     * Documental, separadas por su situación. Solo consulta.
     * @param {string} ver pestaña: por_archivar, sin_conciliar o preparado (otra cosa = por_archivar).
     */
    async consultarPagadas(ver = 'por_archivar') {
      const todas = (await baseDeDatos.obtenerPagadas()).map(conSituacion);
      const pestana = PESTANAS_ARCHIVO.includes(ver) ? ver : 'por_archivar';
      return {
        ver: pestana,
        pagadas: todas.filter((i) => i.situacion === pestana),
        conteos: Object.fromEntries(PESTANAS_ARCHIVO.map((clave) => [clave, todas.filter((i) => i.situacion === clave).length])),
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
     * @throws {import('./error-de-aviso.js').ErrorDeAviso} el correo a Gestión Documental falló.
     */
    async archivarIncapacidad(idIncapacidad, usuario) {
      const actual = await leer(idIncapacidad);
      if (!actual) return null;
      if (situacionArchivo(actual) !== 'por_archivar' || actual.estado !== 'pagada' || actual.enviadaAGestionDocumental) {
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
        await baseDeDatos.deshacerArchivoPreparado(actual.idIncapacidad).catch((errorDeshacer) =>
          console.error('[archivarIncapacidad] No se pudo quitar la marca de archivo preparado', {
            idIncapacidad: actual.idIncapacidad,
            errorDeshacer: resumirError(errorDeshacer),
          }),
        );
        throw error;
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
  };
}
