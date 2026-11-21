// Grupo `cobro` del Control de incapacidades — DS-06 (CU-10).
// Operaciones: registrarCobrada (HU-13) y registrarRechazo (HU-14). Se agregará registrarPago (HU-15).
import { hoyEnColombia, sumarIntervalo } from '../servicios/dias-habiles.js';
import { ErrorDeValidacion } from './error-de-validacion.js';
import { esIdentificador } from './identificador.js';

// DA-38: el tiempo de pago son días calendario, de 1 a 365.
export const TIEMPO_PAGO_MINIMO = 1;
export const TIEMPO_PAGO_MAXIMO = 365;
// Atajos de la pantalla: los tiempos que más informan las entidades.
export const TIEMPOS_FRECUENTES = Object.freeze([15, 30, 45, 60, 90]);

/** Fecha en que la entidad prometió pagar: fecha en que quedó cobrada + tiempo de pago (DA-38). */
export const fechaPrometida = (fechaCobrada, tiempoPago) => sumarIntervalo(fechaCobrada, { dias: tiempoPago });

// EST-01: solo una incapacidad transcrita (radicada) puede quedar cobrada.
export const puedeRegistrarCobrada = (estado) => estado === 'transcrita';

const MENSAJES_ESTADO = {
  null: 'La incapacidad aún no se ha radicado: radíquela primero.',
  rechazada: 'La entidad rechazó la incapacidad: registre una nueva radicación antes.',
  cobrada: 'La incapacidad ya está registrada como cobrada.',
  pagada: 'La incapacidad ya está pagada.',
};
const mensajeEstado = (estado) => MENSAJES_ESTADO[estado ?? 'null'] ?? 'La incapacidad no admite registrarse como cobrada.';

// DA-39: la causal es texto libre, como la informó la entidad.
export const CAUSAL_MINIMO = 3;
export const CAUSAL_MAXIMO = 500;

// EST-01: solo una incapacidad transcrita (radicada) puede quedar rechazada.
export const puedeRegistrarRechazo = (estado) => estado === 'transcrita';

const MENSAJES_RECHAZO = {
  null: 'La incapacidad aún no se ha radicado: radíquela primero.',
  rechazada: 'La incapacidad ya está rechazada: registre la nueva radicación.',
  cobrada: 'La entidad ya aprobó la incapacidad: está registrada como cobrada.',
  pagada: 'La incapacidad ya está pagada.',
};
const mensajeRechazo = (estado) => MENSAJES_RECHAZO[estado ?? 'null'] ?? 'La incapacidad no admite registrar un rechazo.';

/** Valida la causal del rechazo (DA-39). Cuenta caracteres, no unidades UTF-16. @returns {{ valor?: string, error?: string }} */
export function leerCausal(texto) {
  const limpio = typeof texto === 'string' ? texto.trim() : '';
  if (limpio === '') return { error: 'Escriba la causal que informó la entidad.' };
  const largo = [...limpio].length;
  if (largo < CAUSAL_MINIMO) return { error: `Escriba la causal con al menos ${CAUSAL_MINIMO} caracteres.` };
  if (largo > CAUSAL_MAXIMO) return { error: `La causal admite hasta ${CAUSAL_MAXIMO} caracteres.` };
  // Caracteres de control (salvo saltos de línea y tabulador): Postgres no admite el NUL en un texto.
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(limpio)) return { error: 'La causal tiene caracteres no válidos.' };
  return { valor: limpio };
}

/** Valida el texto del formulario. @returns {{ valor?: number, error?: string }} */
export function leerTiempoPago(texto) {
  const limpio = typeof texto === 'string' ? texto.trim() : '';
  if (limpio === '') return { error: 'Escriba en cuántos días pagará la entidad.' };
  if (!/^\d{1,4}$/.test(limpio)) return { error: 'Escriba un número entero de días.' };
  const valor = Number(limpio);
  if (valor < TIEMPO_PAGO_MINIMO || valor > TIEMPO_PAGO_MAXIMO) {
    return { error: `Escriba entre ${TIEMPO_PAGO_MINIMO} y ${TIEMPO_PAGO_MAXIMO} días.` };
  }
  return { valor };
}

export function crearControlCobro({ baseDeDatos, hoy = hoyEnColombia }) {
  return {
    /**
     * Datos de la pantalla «Cobro»: la incapacidad, sus radicaciones y, si ya quedó cobrada, la
     * fecha prometida de pago. Solo consulta. null si la incapacidad no existe.
     */
    async prepararCobro(idIncapacidad) {
      const incapacidad = esIdentificador(idIncapacidad) ? await baseDeDatos.obtenerDatosCobro(Number(idIncapacidad)) : null;
      if (!incapacidad) return null;
      return {
        incapacidad,
        hoy: hoy(),
        puedeRegistrarCobrada: puedeRegistrarCobrada(incapacidad.estado),
        puedeRegistrarRechazo: puedeRegistrarRechazo(incapacidad.estado),
        fechaPrometida:
          incapacidad.tiempoPago != null && incapacidad.fechaCobrada
            ? fechaPrometida(incapacidad.fechaCobrada, incapacidad.tiempoPago)
            : null,
      };
    },

    /**
     * DS-06: registrarCobrada(idIncapacidad, tiempoPago) → actualizarEstado(cobrada)
     * → guardarEstado(cobrada, tiempoPago) — HU-13.CA1. Guarda también la fecha de hoy (DA-38).
     * @param {{ tiempoPago?: string }} datos
     * @returns {Promise<null | { idIncapacidad: number }>} null si la incapacidad no existe.
     * @throws {ErrorDeValidacion} tiempo de pago no válido, o el estado no es transcrita (`estado`).
     */
    async registrarCobrada(idIncapacidad, datos) {
      const actual = esIdentificador(idIncapacidad) ? await baseDeDatos.obtenerDatosCobro(Number(idIncapacidad)) : null;
      if (!actual) return null;
      if (!puedeRegistrarCobrada(actual.estado)) throw new ErrorDeValidacion({ estado: mensajeEstado(actual.estado) });

      const tiempoPago = leerTiempoPago(datos?.tiempoPago);
      if (tiempoPago.error) throw new ErrorDeValidacion({ tiempoPago: tiempoPago.error });

      const guardada = await baseDeDatos.guardarCobrada(actual.idIncapacidad, { tiempoPago: tiempoPago.valor, fechaCobrada: hoy() });
      // Otro usuario cambió el estado entre la consulta y el registro: el UPDATE condicionado no lo pisó.
      if (!guardada) {
        const ahora = await baseDeDatos.obtenerDatosCobro(actual.idIncapacidad);
        throw new ErrorDeValidacion({ estado: mensajeEstado(ahora?.estado === 'transcrita' ? 'cobrada' : ahora?.estado) });
      }
      return { idIncapacidad: actual.idIncapacidad };
    },

    /**
     * DS-06: registrarRechazo(idIncapacidad, causal) → actualizarEstado(rechazada)
     * → guardarRechazo(causal) — HU-14.CA1. Guarda también la fecha de hoy (DA-39). Después se radica de
     * nuevo con HU-10 (HU-14.CA2).
     * @param {{ causal?: string }} datos
     * @returns {Promise<null | { idIncapacidad: number }>} null si la incapacidad no existe.
     * @throws {ErrorDeValidacion} causal no válida (`causal`), o el estado no es transcrita (`estado`).
     */
    async registrarRechazo(idIncapacidad, datos) {
      const actual = esIdentificador(idIncapacidad) ? await baseDeDatos.obtenerDatosCobro(Number(idIncapacidad)) : null;
      if (!actual) return null;
      if (!puedeRegistrarRechazo(actual.estado)) throw new ErrorDeValidacion({ estado: mensajeRechazo(actual.estado) });

      const causal = leerCausal(datos?.causal);
      if (causal.error) throw new ErrorDeValidacion({ causal: causal.error });

      const guardado = await baseDeDatos.guardarRechazo(actual.idIncapacidad, { causal: causal.valor, fechaRechazo: hoy() });
      // Otro usuario respondió primero (cobrada o rechazada): el UPDATE condicionado no lo pisó.
      if (!guardado) {
        const ahora = await baseDeDatos.obtenerDatosCobro(actual.idIncapacidad);
        throw new ErrorDeValidacion({ estado: mensajeRechazo(ahora?.estado === 'transcrita' ? 'rechazada' : ahora?.estado) });
      }
      return { idIncapacidad: actual.idIncapacidad };
    },
  };
}
