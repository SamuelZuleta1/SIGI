// Grupo `cobro` del Control de incapacidades — DS-06 (CU-10).
// Operaciones: registrarCobrada (HU-13). Se agregarán registrarRechazo (HU-14) y registrarPago (HU-15).
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
  };
}
