// Grupo `cobro-juridico` del Control de incapacidades — DS-08 (CU-12).
// Operaciones: prepararRequerimientos (apoyo de la Vista), registrarRequerimiento → guardarRequerimiento (HU-18)
// trasladarACartera → guardarTraslado (HU-19), consultarTrasladadas y prepararDecision (apoyo de la Vista) y
// registrarDecision → guardarDecision (HU-20), la única operación del rol Cartera y Jurídica.
import { diasCalendario, fechaBreve, fechaEnColombia, hoyEnColombia, sumarIntervalo } from '../servicios/dias-habiles.js';
import { DECISIONES, NOMBRES_DECISION } from '../models/incapacidad.model.js';
import { avisarODeshacer } from './error-de-aviso.js';
import { ErrorDeValidacion } from './error-de-validacion.js';
import { esIdentificador } from './identificador.js';
import { evaluarDemora } from './seguimiento.controller.js';

// RN-09: mínimo dos requerimientos antes del traslado a Cartera. Auditoría (decisión 4A): se exige para toda causal
// (antes DA-14 solo advertía).
export const REQUERIMIENTOS_MINIMOS = 2;

// Auditoría (decisión 4A): causal del traslado, de una lista cerrada; el motivo es el detalle libre (DA-44).
export const CAUSALES_TRASLADO = Object.freeze(['180_dias', 'deterioro', 'rechazo']);
export const NOMBRES_CAUSAL = Object.freeze({
  '180_dias': '180 días sin pago',
  deterioro: 'Deterioro crediticio de la entidad',
  rechazo: 'Rechazo de la entidad',
});
// RN «a los 180 días sin pago»: se cuentan desde que la incapacidad quedó cobrada (fecha_cobrada, DA-38).
export const DIAS_SIN_PAGO = 180;

/**
 * Auditoría (decisión 4A): cobro persuasivo = una «cobrada» (con o sin demora) o una «rechazada», sin dar de baja.
 * Cambia DA-05 (solo cobradas con demora).
 */
export const enCobroPersuasivo = ({ estado, decision }) => (estado === 'cobrada' || estado === 'rechazada') && decision !== 'dar_de_baja';

/** Por qué no se puede trasladar con esta causal hoy, o null si se puede (sin contar los requerimientos). */
export function impedimentoDeCausal(incapacidad, causal, hoy) {
  if (causal === 'rechazo') {
    return incapacidad.estado === 'rechazada' ? null : 'La causal «Rechazo de la entidad» es para una incapacidad que la entidad rechazó.';
  }
  if (incapacidad.estado !== 'cobrada') return `La causal «${NOMBRES_CAUSAL[causal]}» es para una incapacidad cobrada.`;
  if (causal === '180_dias') {
    const desde = sumarIntervalo(incapacidad.fechaCobrada, { dias: DIAS_SIN_PAGO });
    const van = diasCalendario(incapacidad.fechaCobrada, hoy);
    if (hoy < desde) {
      return `Van ${van} días desde que quedó cobrada (${fechaBreve(incapacidad.fechaCobrada)}): la causal «180 días sin pago» se puede desde el ${fechaBreve(desde)}.`;
    }
  }
  return null;
}

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

// Auditoría (decisión 4A): el cobro persuasivo es de las cobradas (con o sin demora) y de las rechazadas.
const MENSAJES_ESTADO = {
  null: 'La incapacidad aún no se ha radicado: no tiene cobro que reclamar.',
  transcrita: 'La entidad aún no ha respondido la radicación: regístrela como cobrada o rechazada antes del cobro persuasivo.',
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

// HU-20 (DA-45): se decide sobre una incapacidad trasladada y sin decisión; auditoría (4A): cobrada o rechazada.
const enCartera = (incapacidad) => (incapacidad.estado === 'cobrada' || incapacidad.estado === 'rechazada') && incapacidad.motivoTraslado != null;
const puedeDecidir = (incapacidad) => enCartera(incapacidad) && incapacidad.decision == null;

const mensajeDecision = (incapacidad) => {
  if (incapacidad.decision != null) {
    return `Ya se registró la decisión (${NOMBRES_DECISION[incapacidad.decision].toLowerCase()}) el ${fechaBreve(incapacidad.fechaDecision)}.`;
  }
  if (incapacidad.estado === 'cobrada' || incapacidad.estado === 'rechazada') return 'Esta incapacidad aún no se ha trasladado a Cartera y Jurídica.';
  if (incapacidad.estado === 'pagada') return 'La incapacidad ya está pagada: no hay decisión que registrar.';
  return 'La incapacidad no está en cobro: no hay decisión que registrar.';
};

export function crearControlCobroJuridico({ baseDeDatos, correo, hoy = hoyEnColombia }) {
  const demoraDe = (i, fecha) => (i.tiempoPago != null && i.fechaCobrada != null ? evaluarDemora(i, fecha) : null);

  return {
    /** Datos de la pantalla de requerimientos de una incapacidad. Solo consulta. null si no existe. */
    async prepararRequerimientos(idIncapacidad) {
      const incapacidad = esIdentificador(idIncapacidad) ? await baseDeDatos.obtenerDatosRequerimientos(Number(idIncapacidad)) : null;
      if (!incapacidad) return null;
      const fecha = hoy();
      const enCobro = enCobroPersuasivo(incapacidad);
      const requerimientos = incapacidad.requerimientos.map((r) => ({ ...r, dia: fechaEnColombia(r.registrado) }));
      const trasladada = incapacidad.motivoTraslado != null;
      const cumpleMinimo = requerimientos.length >= REQUERIMIENTOS_MINIMOS;
      // Auditoría (4A): las causales con su disponibilidad de hoy; el formulario solo ofrece las disponibles.
      const causales = CAUSALES_TRASLADO.map((causal) => ({
        causal,
        nombre: NOMBRES_CAUSAL[causal],
        impedimento: impedimentoDeCausal(incapacidad, causal, fecha),
      }));
      return {
        incapacidad: { ...incapacidad, requerimientos },
        pendiente: enCobro,
        demora: demoraDe(incapacidad, fecha),
        trasladada,
        hoy: fecha,
        // HU-18: después del traslado el cobro persuasivo terminó (DA-44).
        puedeRegistrar: enCobro && !trasladada,
        // HU-19 (4A): el paso del traslado se muestra en cobro persuasivo; el formulario, solo con el mínimo cumplido.
        puedeTrasladar: enCobro && !trasladada,
        causales,
        causalesDisponibles: causales.filter((c) => !c.impedimento),
        // HU-19.CA2: pagos posteriores al traslado, con la misma operación registrarPago (HU-15).
        puedeRegistrarPago: enCobro && trasladada,
        total: requerimientos.length,
        minimo: REQUERIMIENTOS_MINIMOS,
        cumpleMinimo,
        faltan: Math.max(REQUERIMIENTOS_MINIMOS - requerimientos.length, 0),
        mensajeEstado: enCobro ? null : mensajeEstado(incapacidad),
      };
    },

    /**
     * DS-08: registrarRequerimiento(fundamentos) → guardarRequerimiento(fundamentos) — HU-18.CA1. Auditoría (4A): en una
     * incapacidad cobrada (con o sin demora) o rechazada, sin trasladar ni dar de baja. Devuelve cuántos lleva (HU-18.CA2).
     * @param {{ fundamentos?: string }} datos
     * @param {{ id: string }} usuario
     * @returns {Promise<null | { idIncapacidad: number, idRequerimiento: number, total: number, cumpleMinimo: boolean }>}
     *   null si la incapacidad no existe.
     * @throws {ErrorDeValidacion} fundamentos no válidos (`fundamentos`), o no admite cobro persuasivo (`estado`).
     */
    async registrarRequerimiento(idIncapacidad, datos, usuario) {
      const actual = esIdentificador(idIncapacidad) ? await baseDeDatos.obtenerDatosRequerimientos(Number(idIncapacidad)) : null;
      if (!actual) return null;
      if (!enCobroPersuasivo(actual)) throw new ErrorDeValidacion({ estado: mensajeEstado(actual) });
      if (actual.motivoTraslado != null) throw new ErrorDeValidacion({ estado: mensajeTrasladada(actual) });

      const fundamentos = leerFundamentos(datos?.fundamentos);
      if (fundamentos.error) throw new ErrorDeValidacion({ fundamentos: fundamentos.error });

      const idRequerimiento = await baseDeDatos.guardarRequerimiento(actual.idIncapacidad, fundamentos.valor, usuario.id);
      // Otro usuario registró el pago, la baja o el traslado entre la consulta y el registro: la transacción no lo guardó.
      if (idRequerimiento == null) {
        const ahora = await baseDeDatos.obtenerDatosRequerimientos(actual.idIncapacidad);
        throw new ErrorDeValidacion({ estado: ahora?.motivoTraslado != null ? mensajeTrasladada(ahora) : mensajeEstado(ahora ?? actual) });
      }
      // El total se lee después de guardar: si otro auxiliar registró uno a la vez, la confirmación cuenta los dos.
      const total = (await baseDeDatos.obtenerDatosRequerimientos(actual.idIncapacidad)).requerimientos.length;
      return { idIncapacidad: actual.idIncapacidad, idRequerimiento, total, cumpleMinimo: total >= REQUERIMIENTOS_MINIMOS };
    },

    /**
     * DS-08: trasladarACartera(id, causal, motivo) → guardarTraslado → notificarTraslado — HU-19.CA1. Auditoría (4A):
     * exige mínimo 2 requerimientos (RN-09) y la condición de la causal — 180 días desde que quedó cobrada, deterioro
     * crediticio (cobrada, aunque no haya demora) o rechazo (rechazada). Primero se guarda el traslado (condicionado en
     * la base: si otro usuario trasladó o pagó a la vez, no sale un correo de más) y después se avisa a Cartera y
     * Jurídica; si el correo falla, se deshace el traslado y se puede reintentar.
     * @param {{ causal?: string, motivo?: string }} datos
     * @returns {Promise<null | { idIncapacidad: number, requerimientos: number, causal: string }>} null si no existe.
     * @throws {ErrorDeValidacion} causal (`causal`), motivo (`motivo`), faltan requerimientos (`requerimientos`) o el
     *   estado no lo admite (`estado`).
     */
    async trasladarACartera(idIncapacidad, datos) {
      const actual = esIdentificador(idIncapacidad) ? await baseDeDatos.obtenerDatosRequerimientos(Number(idIncapacidad)) : null;
      if (!actual) return null;
      if (!enCobroPersuasivo(actual)) throw new ErrorDeValidacion({ estado: mensajeEstado(actual) });
      if (actual.motivoTraslado != null) throw new ErrorDeValidacion({ estado: mensajeTrasladada(actual) });
      const fecha = hoy();

      const errores = {};
      const total = actual.requerimientos.length;
      if (total < REQUERIMIENTOS_MINIMOS) {
        const faltan = REQUERIMIENTOS_MINIMOS - total;
        errores.requerimientos = `Para trasladar se necesitan mínimo ${REQUERIMIENTOS_MINIMOS} requerimientos: falta${faltan === 1 ? '' : 'n'} ${faltan}.`;
      }
      const causal = typeof datos?.causal === 'string' ? datos.causal : '';
      if (!CAUSALES_TRASLADO.includes(causal)) errores.causal = 'Elija la causal del traslado.';
      else {
        const impedimento = impedimentoDeCausal(actual, causal, fecha);
        if (impedimento) errores.causal = impedimento;
      }
      const motivo = leerMotivo(datos?.motivo);
      if (motivo.error) errores.motivo = motivo.error;
      if (Object.keys(errores).length > 0) throw new ErrorDeValidacion(errores);

      const guardado = await baseDeDatos.guardarTraslado(actual.idIncapacidad, { causal, motivo: motivo.valor }, fecha);
      // Otro usuario trasladó, pagó, dio de baja o cambió los requerimientos entre la consulta y el registro: la
      // transacción no lo guardó. Se explica con lo que hay ahora.
      if (!guardado) {
        const ahora = (await baseDeDatos.obtenerDatosRequerimientos(actual.idIncapacidad)) ?? actual;
        if (ahora.motivoTraslado != null) throw new ErrorDeValidacion({ estado: mensajeTrasladada(ahora) });
        if (!enCobroPersuasivo(ahora)) throw new ErrorDeValidacion({ estado: mensajeEstado(ahora) });
        if (ahora.requerimientos.length < REQUERIMIENTOS_MINIMOS) {
          throw new ErrorDeValidacion({ requerimientos: `Para trasladar se necesitan mínimo ${REQUERIMIENTOS_MINIMOS} requerimientos.` });
        }
        throw new ErrorDeValidacion({ causal: impedimentoDeCausal(ahora, causal, fecha) ?? 'No se pudo trasladar: vuelva a intentarlo.' });
      }
      await avisarODeshacer({
        operacion: 'trasladarACartera',
        idIncapacidad: actual.idIncapacidad,
        avisar: () => correo.notificarTraslado(actual, motivo.valor, NOMBRES_CAUSAL[causal]),
        deshacer: () => baseDeDatos.deshacerTraslado(actual.idIncapacidad, motivo.valor),
      });
      return { idIncapacidad: actual.idIncapacidad, requerimientos: total, causal };
    },

    /**
     * DS-08: consultarTrasladadas() — apoyo de la Vista de Cartera y Jurídica (HU-20). Las trasladadas que siguen
     * cobradas, las más antiguas primero. Solo consulta.
     * @param {string} ver pestaña: pendientes o decididas (otra cosa = pendientes).
     */
    async consultarTrasladadas(ver = 'pendientes') {
      const fecha = hoy();
      const trasladadas = (await baseDeDatos.consultarTrasladadas())
        .map((t) => ({ ...t, ...(demoraDe(t, fecha) ?? { conDemora: false }) }))
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
      if (!incapacidad || !enCartera(incapacidad)) return null;
      return {
        incapacidad: {
          ...incapacidad,
          requerimientos: incapacidad.requerimientos.map((r) => ({ ...r, dia: fechaEnColombia(r.registrado) })),
        },
        demora: demoraDe(incapacidad, hoy()),
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
