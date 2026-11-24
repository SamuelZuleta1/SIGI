// Grupo `cobro` del Control de incapacidades — DS-06 (CU-10).
// Operaciones: registrarCobrada (HU-13), registrarRechazo (HU-14) y registrarPago (HU-15), esta última
// compartida con el seguimiento (HU-16, DS-07) y el cobro jurídico (HU-19, DS-08).
import { fechaBreve, hoyEnColombia, sumarIntervalo } from '../servicios/dias-habiles.js';
import { aCentavos, centavosATexto } from '../servicios/moneda.js';
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

// DA-08: cualquier pago deja la incapacidad pagada; después se pueden registrar más pagos.
export const puedeRegistrarPago = (estado) => estado === 'cobrada' || estado === 'pagada';

const MENSAJES_PAGO = {
  null: 'La incapacidad aún no se ha radicado: radíquela primero.',
  transcrita: 'La entidad aún no ha aprobado la incapacidad: regístrela como cobrada antes del pago.',
  rechazada: 'La entidad rechazó la incapacidad: debe radicarse de nuevo antes de registrar un pago.',
};
const mensajePago = (estado) => MENSAJES_PAGO[estado ?? 'null'] ?? 'La incapacidad no admite registrar un pago.';

// Con el archivo preparado (HU-29, DA-59) la incapacidad ya no admite pagos.
export const MENSAJE_PAGO_ARCHIVADA = 'El archivo de esta incapacidad ya está preparado: no admite más pagos.';
const admitePago = (i) => puedeRegistrarPago(i.estado) && !i.archivoPreparado;
const mensajeDePago = (i) => (i && i.archivoPreparado ? MENSAJE_PAGO_ARCHIVADA : mensajePago(i?.estado));

// numeric(14,2): hasta 12 cifras enteras (DA-40).
export const VALOR_MAXIMO_CIFRAS = 12;

// Mensajes del valor del pago (HU-15). Otro campo en pesos, como el IBC (HU-21), pasa los suyos.
export const MENSAJES_VALOR = Object.freeze({
  vacio: 'Escriba el valor que pagó la entidad.',
  formato: 'Escriba el valor en pesos, por ejemplo 1.250.000 o 1.250.000,50.',
  grande: 'El valor es demasiado grande.',
  cero: 'El valor debe ser mayor que cero.',
});

/**
 * Valida un valor en pesos (DA-40). Admite «1234567», «1.234.567», «1.234.567,50» y el signo «$».
 * El punto es separador de miles y la coma, de decimales (uso colombiano).
 * @param {{ vacio: string, formato: string, grande: string, cero: string }} [mensajes] los del pago por omisión.
 * @returns {{ valor?: string, centavos?: number, error?: string }} valor como texto para numeric(14,2).
 */
export function leerValor(texto, mensajes = MENSAJES_VALOR) {
  const limpio = typeof texto === 'string' ? texto.replace(/[\s\u00a0\u202f$]/g, '') : '';
  if (limpio === '') return { error: mensajes.vacio };
  const conMiles = /^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(limpio);
  if (!conMiles && !/^\d+(,\d{1,2})?$/.test(limpio)) {
    return { error: mensajes.formato };
  }
  const [enteros, decimales = ''] = limpio.replace(/\./g, '').split(',');
  const sinCeros = enteros.replace(/^0+(?=\d)/, '');
  if (sinCeros.length > VALOR_MAXIMO_CIFRAS) return { error: mensajes.grande };
  const centavos = Number(sinCeros) * 100 + Number(decimales.padEnd(2, '0'));
  if (centavos <= 0) return { error: mensajes.cero };
  return { valor: centavosATexto(centavos), centavos };
}

const esFechaValida = (valor) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor) || valor < '0001-01-01') return false;
  const fecha = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().startsWith(valor);
};

/**
 * Valida la fecha del pago, que escribe el auxiliar (DA-16): no futura ni anterior al inicio de la incapacidad (DA-40).
 * @returns {{ valor?: string, error?: string }}
 */
export function leerFechaPago(texto, { hoy, fechaInicio }) {
  const limpio = typeof texto === 'string' ? texto.trim() : '';
  if (limpio === '') return { error: 'Escriba la fecha en que la entidad pagó.' };
  if (!esFechaValida(limpio)) return { error: 'Escriba una fecha válida (día, mes y año).' };
  if (limpio > hoy) return { error: 'La fecha del pago no puede ser posterior a hoy.' };
  if (fechaInicio && limpio < fechaInicio) {
    return { error: `La fecha del pago no puede ser anterior al inicio de la incapacidad (${fechaBreve(fechaInicio)}).` };
  }
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
        puedeRegistrarPago: admitePago(incapacidad),
        totalPagado: centavosATexto(incapacidad.pagos.reduce((total, p) => total + aCentavos(p.valor), 0)),
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

    /**
     * DS-06/07/08: registrarPago(idIncapacidad, valor, fechaPago) → actualizarEstado(pagada)
     * → guardarPago(valor, fechaPago) — HU-15. Una sola operación para el cobro, el seguimiento (HU-16)
     * y el cobro jurídico (HU-19) (HU-15.CA2). Admite varios pagos (HU-15.CA3, DA-08).
     * @param {{ valor?: string, fechaPago?: string }} datos
     * @param {{ id: string }} usuario quien registra (creado_por).
     * @returns {Promise<null | { idIncapacidad: number, idPago: number }>} null si la incapacidad no existe.
     * @throws {ErrorDeValidacion} valor o fecha no válidos, o el estado no es cobrada ni pagada (`estado`).
     */
    async registrarPago(idIncapacidad, datos, usuario) {
      const actual = esIdentificador(idIncapacidad) ? await baseDeDatos.obtenerDatosCobro(Number(idIncapacidad)) : null;
      if (!actual) return null;
      if (!admitePago(actual)) throw new ErrorDeValidacion({ estado: mensajeDePago(actual) });

      const valor = leerValor(datos?.valor);
      const fechaPago = leerFechaPago(datos?.fechaPago, { hoy: hoy(), fechaInicio: actual.fechaInicio });
      const errores = {};
      if (valor.error) errores.valor = valor.error;
      if (fechaPago.error) errores.fechaPago = fechaPago.error;
      if (Object.keys(errores).length) throw new ErrorDeValidacion(errores);

      const idPago = await baseDeDatos.guardarPago(actual.idIncapacidad, { valor: valor.valor, fechaPago: fechaPago.valor }, usuario.id);
      // Otro usuario cambió el estado entre la consulta y el registro: la transacción no guardó el pago.
      if (idPago == null) {
        const ahora = await baseDeDatos.obtenerDatosCobro(actual.idIncapacidad);
        throw new ErrorDeValidacion({ estado: mensajeDePago(ahora) });
      }
      return { idIncapacidad: actual.idIncapacidad, idPago };
    },
  };
}
