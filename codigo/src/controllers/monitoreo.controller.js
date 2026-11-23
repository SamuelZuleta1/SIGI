// Grupo `monitoreo` del Control de incapacidades — DS-10 (CU-14).
// Operaciones: consultarReporteProlongadas (HU-22, en vivo: DA-19), prepararProlongada (apoyo de la Vista),
// registrarConcepto → guardarConcepto + comunicarConcepto (HU-22) y registrarFaltaConcepto → guardarFaltaConcepto +
// avisarFaltaConcepto (HU-23), y registrarSuspensionPago → guardarSuspensionPago + notificarSuspensionPago (HU-24). El envío del concepto a la AFP lo hace el auxiliar fuera de SIGI.
import { avisarODeshacer } from './error-de-aviso.js';
import { ErrorDeValidacion } from './error-de-validacion.js';
import { esIdentificador } from './identificador.js';

// HU-22: «prolongada» es la de más de 90 días. El control del concepto de rehabilitación es el día 120.
export const DIAS_PROLONGADA = 90;
export const DIA_CONCEPTO = 120;
export const DIA_SUSPENSION = 180;

// El concepto es texto libre, como lo emite la entidad (DA-46).
export const CONCEPTO_MINIMO = 10;
export const CONCEPTO_MAXIMO = 2000;

/** Valida el concepto de rehabilitación. Cuenta caracteres, no unidades UTF-16. @returns {{ valor?: string, error?: string }} */
export function leerConcepto(texto) {
  const limpio = typeof texto === 'string' ? texto.trim() : '';
  if (limpio === '') return { error: 'Escriba el concepto de rehabilitación que emitió la entidad.' };
  const largo = [...limpio].length;
  if (largo < CONCEPTO_MINIMO) return { error: `Escriba el concepto con al menos ${CONCEPTO_MINIMO} caracteres.` };
  if (largo > CONCEPTO_MAXIMO) return { error: `El concepto admite hasta ${CONCEPTO_MAXIMO} caracteres.` };
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(limpio)) return { error: 'El concepto tiene caracteres no válidos.' };
  return { valor: limpio };
}

/** Hito de control según los días (DA-46). */
export function hitoDe(dias) {
  if (dias > DIA_SUSPENSION) return { clave: 'mas_180', nombre: 'Más de 180 días' };
  if (dias >= DIA_CONCEPTO) return { clave: 'dia_120', nombre: 'Concepto del día 120' };
  return { clave: 'mas_90', nombre: 'Más de 90 días' };
}

/** Estado del concepto de una prolongada: registrado, falta (ya avisada) o pendiente. */
export const estadoConcepto = (i) => (i.concepto != null ? 'registrado' : i.faltaConcepto ? 'falta' : 'pendiente');

const esProlongada = (i) => i.diasIncapacidad > DIAS_PROLONGADA;
// HU-22/HU-23: el concepto se pide a la entidad el día 120; antes no hay concepto que registrar ni falta que avisar (DA-47).
const llegoAlHito = (i) => i.diasIncapacidad >= DIA_CONCEPTO;

export const FILTROS_PROLONGADAS = Object.freeze({
  pendientes: (i) => estadoConcepto(i) === 'pendiente',
  falta: (i) => estadoConcepto(i) === 'falta',
  con_concepto: (i) => estadoConcepto(i) === 'registrado',
});

const mensajeNoProlongada = (i) =>
  `La incapacidad lleva ${i.diasIncapacidad} ${i.diasIncapacidad === 1 ? 'día' : 'días'}: el monitoreo es para las de más de ${DIAS_PROLONGADA} días.`;
const mensajeAunNoEsDia120 = (i) =>
  `La incapacidad lleva ${i.diasIncapacidad} días: el concepto de rehabilitación se pide a la entidad el día ${DIA_CONCEPTO}.`;
const mensajeConcepto = (i) => {
  if (i.concepto != null) return 'Esta incapacidad ya tiene el concepto de rehabilitación registrado.';
  return esProlongada(i) ? mensajeAunNoEsDia120(i) : mensajeNoProlongada(i);
};
const mensajeFalta = (i) => {
  if (i.concepto != null) return 'Esta incapacidad ya tiene el concepto de rehabilitación: no hay falta que registrar.';
  if (i.faltaConcepto) return 'Ya se registró la falta del concepto y se avisó al colaborador.';
  return esProlongada(i) ? mensajeAunNoEsDia120(i) : mensajeNoProlongada(i);
};

const superaSuspension = (i) => i.diasIncapacidad > DIA_SUSPENSION;
const mensajeSuspension = (i) => {
  if (i.pagoSuspendido) return 'Ya se registró la suspensión del pago y se avisó al colaborador.';
  return `La incapacidad lleva ${i.diasIncapacidad} ${i.diasIncapacidad === 1 ? 'día' : 'días'}: el pago se suspende cuando supera los ${DIA_SUSPENSION} días.`;
};
const puedeRegistrarSuspension = (i) => superaSuspension(i) && !i.pagoSuspendido;

const puedeRegistrarConcepto = (i) => llegoAlHito(i) && i.concepto == null;
const puedeRegistrarFalta = (i) => llegoAlHito(i) && i.concepto == null && !i.faltaConcepto;

export function crearControlMonitoreo({ baseDeDatos, correo }) {
  const leer = (id) => (esIdentificador(id) ? baseDeDatos.obtenerDatosProlongada(Number(id)) : null);

  return {
    /**
     * DS-10: consultarReporteProlongadas() — HU-22.CA1. Calcula en el momento (DA-19): las incapacidades de más de
     * 90 días, las más largas primero. Solo consulta.
     * @param {string} ver pestaña: pendientes, falta o con_concepto (otra cosa = pendientes).
     */
    async consultarReporteProlongadas(ver = 'pendientes') {
      const todas = (await baseDeDatos.consultarProlongadas(DIAS_PROLONGADA)).map((i) => ({
        ...i,
        hito: hitoDe(i.diasIncapacidad),
        estadoConcepto: estadoConcepto(i),
      }));
      const pestana = Object.hasOwn(FILTROS_PROLONGADAS, ver) ? ver : 'pendientes';
      return {
        ver: pestana,
        prolongadas: todas.filter(FILTROS_PROLONGADAS[pestana]),
        conteos: Object.fromEntries(Object.entries(FILTROS_PROLONGADAS).map(([clave, f]) => [clave, todas.filter(f).length])),
      };
    },

    /** Datos de la pantalla de una prolongada. Solo consulta. null si no existe o no es prolongada. */
    async prepararProlongada(idIncapacidad) {
      const incapacidad = await leer(idIncapacidad);
      if (!incapacidad || !esProlongada(incapacidad)) return null;
      return {
        incapacidad,
        hito: hitoDe(incapacidad.diasIncapacidad),
        estadoConcepto: estadoConcepto(incapacidad),
        puedeRegistrarConcepto: puedeRegistrarConcepto(incapacidad),
        puedeRegistrarFalta: puedeRegistrarFalta(incapacidad),
        suspensionPendiente: puedeRegistrarSuspension(incapacidad),
        suspensionRegistrada: incapacidad.pagoSuspendido,
        mostrarSuspension: superaSuspension(incapacidad) || incapacidad.pagoSuspendido,
        hitoAlcanzado: llegoAlHito(incapacidad),
      };
    },

    /**
     * DS-10: registrarConcepto(concepto) → guardarConcepto(concepto) → comunicarConcepto(concepto) — HU-22.CA2.
     * Primero se guarda (condicionado en la base) y solo entonces se avisa al colaborador: si otro usuario lo
     * registró a la vez no sale un correo de más; si el correo falla, se deshace y se puede reintentar.
     * @param {{ concepto?: string }} datos
     * @returns {Promise<null | { idIncapacidad: number }>} null si no existe.
     * @throws {ErrorDeValidacion} concepto no válido (`concepto`), o no admite concepto (`estado`).
     */
    async registrarConcepto(idIncapacidad, datos) {
      const actual = await leer(idIncapacidad);
      if (!actual) return null;
      if (!puedeRegistrarConcepto(actual)) throw new ErrorDeValidacion({ estado: mensajeConcepto(actual) });
      const concepto = leerConcepto(datos?.concepto);
      if (concepto.error) throw new ErrorDeValidacion({ concepto: concepto.error });

      const guardado = await baseDeDatos.guardarConcepto(actual.idIncapacidad, concepto.valor, DIA_CONCEPTO);
      if (!guardado) {
        const ahora = await leer(actual.idIncapacidad);
        throw new ErrorDeValidacion({ estado: mensajeConcepto(ahora ?? actual) });
      }
      await avisarODeshacer({
        operacion: 'registrarConcepto',
        idIncapacidad: actual.idIncapacidad,
        avisar: () => correo.comunicarConcepto(actual),
        deshacer: () => baseDeDatos.deshacerConcepto(actual.idIncapacidad, concepto.valor, actual.faltaConcepto),
      });
      return { idIncapacidad: actual.idIncapacidad };
    },

    /**
     * DS-10: registrarFaltaConcepto() → guardarFaltaConcepto() → avisarFaltaConcepto() — HU-23.CA1. Deja constancia de
     * que la entidad no emitió el concepto y avisa al colaborador (mismo orden que registrarConcepto).
     * @returns {Promise<null | { idIncapacidad: number }>} null si no existe.
     * @throws {ErrorDeValidacion} no admite registrar la falta (`estado`).
     */
    async registrarFaltaConcepto(idIncapacidad) {
      const actual = await leer(idIncapacidad);
      if (!actual) return null;
      if (!puedeRegistrarFalta(actual)) throw new ErrorDeValidacion({ estado: mensajeFalta(actual) });

      const guardado = await baseDeDatos.guardarFaltaConcepto(actual.idIncapacidad, DIA_CONCEPTO);
      if (!guardado) {
        const ahora = await leer(actual.idIncapacidad);
        throw new ErrorDeValidacion({ estado: mensajeFalta(ahora ?? actual) });
      }
      await avisarODeshacer({
        operacion: 'registrarFaltaConcepto',
        idIncapacidad: actual.idIncapacidad,
        avisar: () => correo.avisarFaltaConcepto(actual),
        deshacer: () => baseDeDatos.deshacerFaltaConcepto(actual.idIncapacidad),
      });
      return { idIncapacidad: actual.idIncapacidad };
    },

    /**
     * DS-10: registrarSuspensionPago() → guardarSuspensionPago() → notificarSuspensionPago() — HU-24.CA1. Solo si supera
     * 180 días y no se registró antes; primero se guarda y luego se avisa al colaborador (mismo orden que el concepto).
     * El reintegro de pagos de más de 180 días se gestiona fuera de SIGI.
     * @returns {Promise<null | { idIncapacidad: number }>} null si no existe.
     * @throws {ErrorDeValidacion} no admite la suspensión (`suspension`).
     */
    async registrarSuspensionPago(idIncapacidad) {
      const actual = await leer(idIncapacidad);
      if (!actual) return null;
      if (!puedeRegistrarSuspension(actual)) throw new ErrorDeValidacion({ suspension: mensajeSuspension(actual) });

      const guardado = await baseDeDatos.guardarSuspensionPago(actual.idIncapacidad, DIA_SUSPENSION);
      if (!guardado) {
        const ahora = await leer(actual.idIncapacidad);
        throw new ErrorDeValidacion({ suspension: mensajeSuspension(ahora ?? actual) });
      }
      await avisarODeshacer({
        operacion: 'registrarSuspensionPago',
        idIncapacidad: actual.idIncapacidad,
        avisar: () => correo.notificarSuspensionPago(actual),
        deshacer: () => baseDeDatos.deshacerSuspensionPago(actual.idIncapacidad),
      });
      return { idIncapacidad: actual.idIncapacidad };
    },
  };
}
