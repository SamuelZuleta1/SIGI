// Grupo `cobro-juridico` del Control de incapacidades — DS-08 (CU-12).
// Operaciones: prepararRequerimientos (apoyo de la Vista), registrarRequerimiento → guardarRequerimiento (HU-18)
// trasladarACartera → guardarTraslado (HU-19), consultarTrasladadas y prepararDecision (apoyo de la Vista) y
// registrarDecision → guardarDecision (HU-20), la única operación del rol Cartera y Jurídica.
import { fechaBreve, fechaEnColombia, hoyEnColombia } from '../servicios/dias-habiles.js';
import { DECISIONES, NOMBRES_DECISION } from '../models/incapacidad.model.js';
import { avisarODeshacer } from './error-de-aviso.js';
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
const mensajeTrasladada = (incapacidad) =>
  `Esta incapacidad ya se trasladó a Cartera y Jurídica el ${fechaBreve(incapacidad.fechaTraslado)}.`;
const mensajeEstado = (incapacidad) =>
  incapacidad?.decision === 'dar_de_baja'
    ? 'Cartera y Jurídica dio de baja esta acreencia: ya no tiene cobro persuasivo.'
    : (MENSAJES_ESTADO[incapacidad?.estado ?? 'null'] ?? 'La incapacidad no admite cobro persuasivo.');

// DA-44: el motivo del traslado es texto libre («180 días sin pago», «deterioro crediticio»…), como la causal (DA-39).
export const MOTIVO_MINIMO = 3;
export const MOTIVO_MAXIMO = 500;

/** Valida el motivo del traslado (DA-44). Cuenta caracteres, no unidades UTF-16. @returns {{ valor?: string, error?: string }} */
export function leerMotivo(texto) {
  const limpio = typeof texto === 'string' ? texto.trim() : '';
  if (limpio === '') return { error: 'Escriba el motivo del traslado.' };
  const largo = [...limpio].length;
  if (largo < MOTIVO_MINIMO) return { error: `Escriba el motivo con al menos ${MOTIVO_MINIMO} caracteres.` };
  if (largo > MOTIVO_MAXIMO) return { error: `El motivo admite hasta ${MOTIVO_MAXIMO} caracteres.` };
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(limpio)) return { error: 'El motivo tiene caracteres no válidos.' };
  return { valor: limpio };
}

// Pestañas de la lista de Cartera y Jurídica (DA-45): las que esperan decisión y las ya decididas.
export const FILTROS_TRASLADADAS = Object.freeze({
  pendientes: (t) => t.decision == null,
  decididas: (t) => t.decision != null,
});

// HU-20 (DA-45): se decide sobre una incapacidad cobrada, ya trasladada y sin decisión.
const puedeDecidir = (incapacidad) =>
  incapacidad.estado === 'cobrada' && incapacidad.motivoTraslado != null && incapacidad.decision == null;

const mensajeDecision = (incapacidad) => {
  if (incapacidad.decision != null) {
    return `Ya se registró la decisión (${NOMBRES_DECISION[incapacidad.decision].toLowerCase()}) el ${fechaBreve(incapacidad.fechaDecision)}.`;
  }
  if (incapacidad.estado === 'cobrada') return 'Esta incapacidad aún no se ha trasladado a Cartera y Jurídica.';
  if (incapacidad.estado === 'pagada') return 'La incapacidad ya está pagada: no hay decisión que registrar.';
  return 'La incapacidad no está en cobro: no hay decisión que registrar.';
};

export function crearControlCobroJuridico({ baseDeDatos, correo, hoy = hoyEnColombia }) {
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
      const trasladada = incapacidad.motivoTraslado != null;
      const conDemora = pendiente && demora?.conDemora === true;
      return {
        incapacidad: { ...incapacidad, requerimientos },
        pendiente,
        demora,
        trasladada,
        hoy: hoy(),
        // HU-18: después del traslado el cobro persuasivo terminó (DA-44).
        puedeRegistrar: conDemora && !trasladada,
        puedeTrasladar: conDemora && !trasladada,
        // HU-19.CA1 (DA-14): con menos de dos requerimientos se advierte y se permite.
        advertirMinimo: requerimientos.length < REQUERIMIENTOS_MINIMOS,
        // HU-19.CA2: pagos posteriores al traslado, con la misma operación registrarPago (HU-15).
        puedeRegistrarPago: pendiente && trasladada,
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
      if (actual.motivoTraslado != null) throw new ErrorDeValidacion({ estado: mensajeTrasladada(actual) });
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
      // El total se lee después de guardar: si otro auxiliar registró uno a la vez, la confirmación cuenta los dos.
      const total = (await baseDeDatos.obtenerDatosRequerimientos(actual.idIncapacidad)).requerimientos.length;
      return { idIncapacidad: actual.idIncapacidad, idRequerimiento, total, cumpleMinimo: total >= REQUERIMIENTOS_MINIMOS };
    },

    /**
     * DS-08: trasladarACartera(id, motivo) → notificarTraslado(motivo) → guardarTraslado(motivo) — HU-19.CA1.
     * Solo con la incapacidad pendiente de pago, en demora y sin trasladar antes (DA-05, DA-44). Con menos de dos
     * requerimientos se advierte y se permite (DA-14). Primero se guarda el traslado (condicionado en la base) y
     * solo entonces se avisa a Cartera y Jurídica: si otro usuario trasladó o pagó a la vez, no sale ningún correo
     * de más; si el correo falla, se deshace el traslado y se puede reintentar.
     * @param {{ motivo?: string }} datos
     * @returns {Promise<null | { idIncapacidad: number, requerimientos: number, advertencia: boolean }>} null si no existe.
     * @throws {ErrorDeValidacion} motivo no válido (`motivo`), o no admite traslado (`estado`).
     */
    async trasladarACartera(idIncapacidad, datos) {
      const actual = esIdentificador(idIncapacidad) ? await baseDeDatos.obtenerDatosRequerimientos(Number(idIncapacidad)) : null;
      if (!actual) return null;
      if (!estaPendienteDePago(actual)) throw new ErrorDeValidacion({ estado: mensajeEstado(actual) });
      if (actual.motivoTraslado != null) throw new ErrorDeValidacion({ estado: mensajeTrasladada(actual) });
      const demora = evaluarDemora(actual, hoy());
      if (!demora.conDemora) throw new ErrorDeValidacion(sinDemora(demora));

      const motivo = leerMotivo(datos?.motivo);
      if (motivo.error) throw new ErrorDeValidacion({ motivo: motivo.error });

      const guardado = await baseDeDatos.guardarTraslado(actual.idIncapacidad, motivo.valor, hoy());
      // Otro usuario trasladó, pagó o dio de baja entre la consulta y el registro: la transacción no lo guardó.
      if (!guardado) {
        const ahora = await baseDeDatos.obtenerDatosRequerimientos(actual.idIncapacidad);
        throw new ErrorDeValidacion({
          estado: ahora?.motivoTraslado != null ? mensajeTrasladada(ahora) : mensajeEstado(ahora ?? actual),
        });
      }
      await avisarODeshacer({
        operacion: 'trasladarACartera',
        idIncapacidad: actual.idIncapacidad,
        avisar: () => correo.notificarTraslado(actual, motivo.valor),
        deshacer: () => baseDeDatos.deshacerTraslado(actual.idIncapacidad, motivo.valor),
      });
      const requerimientos = actual.requerimientos.length;
      return { idIncapacidad: actual.idIncapacidad, requerimientos, advertencia: requerimientos < REQUERIMIENTOS_MINIMOS };
    },

    /**
     * DS-08: consultarTrasladadas() — apoyo de la Vista de Cartera y Jurídica (HU-20). Las trasladadas que siguen
     * cobradas, las más antiguas primero. Solo consulta.
     * @param {string} ver pestaña: pendientes o decididas (otra cosa = pendientes).
     */
    async consultarTrasladadas(ver = 'pendientes') {
      const fecha = hoy();
      const trasladadas = (await baseDeDatos.consultarTrasladadas())
        .map((t) => ({ ...t, ...evaluarDemora(t, fecha) }))
        .sort((a, b) => a.fechaTraslado.localeCompare(b.fechaTraslado) || a.idIncapacidad - b.idIncapacidad);
      const pestana = Object.hasOwn(FILTROS_TRASLADADAS, ver) ? ver : 'pendientes';
      return {
        ver: pestana,
        trasladadas: trasladadas.filter(FILTROS_TRASLADADAS[pestana]),
        conteos: Object.fromEntries(Object.entries(FILTROS_TRASLADADAS).map(([clave, f]) => [clave, trasladadas.filter(f).length])),
      };
    },

    /**
     * Datos de la pantalla de decisión de una incapacidad. Solo consulta. null si no existe o si no es de Cartera y
     * Jurídica (no está cobrada y trasladada): el rol solo ve lo que le toca (DA-02, DA-45).
     */
    async prepararDecision(idIncapacidad) {
      const incapacidad = esIdentificador(idIncapacidad) ? await baseDeDatos.obtenerDatosRequerimientos(Number(idIncapacidad)) : null;
      if (!incapacidad || incapacidad.estado !== 'cobrada' || incapacidad.motivoTraslado == null) return null;
      const cobrada = incapacidad.tiempoPago != null && incapacidad.fechaCobrada != null;
      return {
        incapacidad: {
          ...incapacidad,
          requerimientos: incapacidad.requerimientos.map((r) => ({ ...r, dia: fechaEnColombia(r.registrado) })),
        },
        demora: cobrada ? evaluarDemora(incapacidad, hoy()) : null,
        puedeDecidir: puedeDecidir(incapacidad),
        mensajeEstado: puedeDecidir(incapacidad) ? null : mensajeDecision(incapacidad),
      };
    },

    /**
     * DS-08: registrarDecision(decision) → guardarDecision(decision) — HU-20.CA1. Cartera y Jurídica decide si
     * recupera el cobro o lo da de baja. Solo registra: no cambia el estado (HU-20.CA2) y se tramita fuera de SIGI.
     * Una sola decisión, solo sobre una incapacidad cobrada y trasladada (DA-45).
     * @param {{ decision?: string }} datos
     * @returns {Promise<null | { idIncapacidad: number, decision: string }>} null si la incapacidad no existe.
     * @throws {ErrorDeValidacion} decisión no válida (`decision`), o no admite decisión (`estado`).
     */
    async registrarDecision(idIncapacidad, datos) {
      const actual = esIdentificador(idIncapacidad) ? await baseDeDatos.obtenerDatosRequerimientos(Number(idIncapacidad)) : null;
      if (!actual) return null;
      if (!puedeDecidir(actual)) throw new ErrorDeValidacion({ estado: mensajeDecision(actual) });
      const decision = typeof datos?.decision === 'string' ? datos.decision : '';
      if (!DECISIONES.includes(decision)) throw new ErrorDeValidacion({ decision: 'Escoja si recupera el cobro o lo da de baja.' });

      const guardado = await baseDeDatos.guardarDecision(actual.idIncapacidad, decision, hoy());
      // Otro usuario decidió o se pagó entre la consulta y el registro: la transacción no lo guardó.
      if (!guardado) {
        const ahora = await baseDeDatos.obtenerDatosRequerimientos(actual.idIncapacidad);
        throw new ErrorDeValidacion({ estado: mensajeDecision(ahora ?? actual) });
      }
      return { idIncapacidad: actual.idIncapacidad, decision };
    },
  };
}
