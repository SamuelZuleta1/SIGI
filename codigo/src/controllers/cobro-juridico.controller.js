// Grupo `cobro-juridico` del Control de incapacidades — DS-08 (CU-12).
// Operaciones: prepararRequerimientos (apoyo de la Vista) y registrarRequerimiento → guardarRequerimiento (HU-18).
// El traslado a Cartera (HU-19) y la decisión (HU-20) se agregan a este grupo.
import { fechaBreve, fechaEnColombia, hoyEnColombia } from '../servicios/dias-habiles.js';
import { ErrorDeValidacion } from './error-de-validacion.js';
import { esIdentificador } from './identificador.js';
import { estaPendienteDePago, evaluarDemora } from './seguimiento.controller.js';

// RN-09: mínimo dos requerimientos antes del traslado a Cartera (HU-19 solo advierte si hay menos, DA-14).
export const REQUERIMIENTOS_MINIMOS = 2;

// DA-43: los fundamentos son texto libre.
export const FUNDAMENTOS_MINIMO = 10;
export const FUNDAMENTOS_MAXIMO = 2000;

/** Valida los fundamentos del requerimiento (DA-43). Cuenta caracteres, no unidades UTF-16. @returns {{ valor?: string, error?: string }} */
export function leerFundamentos(texto) {
  const limpio = typeof texto === 'string' ? texto.trim() : '';
  if (limpio === '') return { error: 'Escriba los fundamentos del requerimiento.' };
  const largo = [...limpio].length;
  if (largo < FUNDAMENTOS_MINIMO) return { error: `Escriba los fundamentos con al menos ${FUNDAMENTOS_MINIMO} caracteres.` };
  if (largo > FUNDAMENTOS_MAXIMO) return { error: `Los fundamentos admiten hasta ${FUNDAMENTOS_MAXIMO} caracteres.` };
  // Caracteres de control (salvo saltos de línea y tabulador): Postgres no admite el NUL en un texto.
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(limpio)) return { error: 'Los fundamentos tienen caracteres no válidos.' };
  return { valor: limpio };
}

// DA-05: el cobro persuasivo se aplica solo a las cobradas con demora. Una rechazada solo vuelve a radicarse.
const MENSAJES_ESTADO = {
  null: 'La incapacidad aún no se ha radicado: no tiene cobro que reclamar.',
  transcrita: 'La entidad aún no ha aprobado la incapacidad: regístrela como cobrada antes del cobro persuasivo.',
  rechazada: 'La entidad rechazó la incapacidad: no tiene cobro persuasivo, debe radicarse de nuevo.',
  pagada: 'La incapacidad ya está pagada: no necesita cobro persuasivo.',
};
const mensajeEstado = (incapacidad) =>
  incapacidad?.decision === 'dar_de_baja'
    ? 'Cartera y Jurídica dio de baja esta acreencia: ya no tiene cobro persuasivo.'
    : (MENSAJES_ESTADO[incapacidad?.estado ?? 'null'] ?? 'La incapacidad no admite cobro persuasivo.');

export function crearControlCobroJuridico({ baseDeDatos, hoy = hoyEnColombia }) {
  const sinDemora = (demora) => ({
    estado: `La entidad aún está dentro del plazo (hasta el ${fechaBreve(demora.fechaPrometida)}): el cobro persuasivo se hace cuando hay demora.`,
  });

  return {
    /** Datos de la pantalla de requerimientos de una incapacidad. Solo consulta. null si no existe. */
    async prepararRequerimientos(idIncapacidad) {
      const incapacidad = esIdentificador(idIncapacidad) ? await baseDeDatos.obtenerDatosRequerimientos(Number(idIncapacidad)) : null;
      if (!incapacidad) return null;
      const pendiente = estaPendienteDePago(incapacidad);
      const cobrada = incapacidad.tiempoPago != null && incapacidad.fechaCobrada != null;
      const demora = cobrada ? evaluarDemora(incapacidad, hoy()) : null;
      const requerimientos = incapacidad.requerimientos.map((r) => ({ ...r, dia: fechaEnColombia(r.registrado) }));
      return {
        incapacidad: { ...incapacidad, requerimientos },
        pendiente,
        demora,
        puedeRegistrar: pendiente && demora?.conDemora === true,
        total: requerimientos.length,
        minimo: REQUERIMIENTOS_MINIMOS,
        cumpleMinimo: requerimientos.length >= REQUERIMIENTOS_MINIMOS,
        mensajeEstado: pendiente ? null : mensajeEstado(incapacidad),
      };
    },

    /**
     * DS-08: registrarRequerimiento(fundamentos) → guardarRequerimiento(fundamentos) — HU-18.CA1. Solo con la
     * incapacidad pendiente de pago y en demora (DA-05, DA-43). Devuelve cuántos requerimientos lleva (HU-18.CA2).
     * @param {{ fundamentos?: string }} datos
     * @param {{ id: string }} usuario
     * @returns {Promise<null | { idIncapacidad: number, idRequerimiento: number, total: number, cumpleMinimo: boolean }>}
     *   null si la incapacidad no existe.
     * @throws {ErrorDeValidacion} fundamentos no válidos (`fundamentos`), o no admite cobro persuasivo (`estado`).
     */
    async registrarRequerimiento(idIncapacidad, datos, usuario) {
      const actual = esIdentificador(idIncapacidad) ? await baseDeDatos.obtenerDatosRequerimientos(Number(idIncapacidad)) : null;
      if (!actual) return null;
      if (!estaPendienteDePago(actual)) throw new ErrorDeValidacion({ estado: mensajeEstado(actual) });
      const demora = evaluarDemora(actual, hoy());
      if (!demora.conDemora) throw new ErrorDeValidacion(sinDemora(demora));

      const fundamentos = leerFundamentos(datos?.fundamentos);
      if (fundamentos.error) throw new ErrorDeValidacion({ fundamentos: fundamentos.error });

      const idRequerimiento = await baseDeDatos.guardarRequerimiento(actual.idIncapacidad, fundamentos.valor, usuario.id);
      // Otro usuario registró el pago (o la baja) entre la consulta y el registro: la transacción no lo guardó.
      if (idRequerimiento == null) {
        const ahora = await baseDeDatos.obtenerDatosRequerimientos(actual.idIncapacidad);
        throw new ErrorDeValidacion({ estado: mensajeEstado(ahora ?? actual) });
      }
      const total = actual.requerimientos.length + 1;
      return { idIncapacidad: actual.idIncapacidad, idRequerimiento, total, cumpleMinimo: total >= REQUERIMIENTOS_MINIMOS };
    },
  };
}
