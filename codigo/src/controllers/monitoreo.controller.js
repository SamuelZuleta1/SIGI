// Grupo `monitoreo` del Control de incapacidades — DS-10 (CU-14).
// Operaciones: consultarReporteProlongadas (HU-22, en vivo: DA-19), prepararProlongada (apoyo de la Vista),
// registrarConcepto → guardarConcepto + comunicarConcepto (HU-22) y registrarFaltaConcepto → guardarFaltaConcepto +
// avisarFaltaConcepto (HU-23), y registrarSuspensionPago → guardarSuspensionPago + notificarSuspensionPago (HU-24).
// El envío del concepto a la AFP lo hace el auxiliar fuera de SIGI.
// Los hitos se cumplen por fecha, igual que las alertas (DA-49): el caso dura N días o más y ya llegó al día N. Con
// prórrogas (DA-50) cuentan los días del caso, y el caso se monitorea en su certificado vigente (el último).
import { fechaBreve, hoyEnColombia } from '../servicios/dias-habiles.js';
import { avisarODeshacer } from './error-de-aviso.js';
import { ErrorDeValidacion } from './error-de-validacion.js';
import {
  DIA_AFP,
  DIA_CONCEPTO,
  DIA_PENSION,
  DIA_SUSPENSION,
  DIAS_PROLONGADA,
  condicionDelDia,
  diaActual,
  diasDelCaso,
  fechaDelDia,
  llegoAlDia,
} from './hitos.js';
import { esIdentificador } from './identificador.js';

export { DIA_CONCEPTO, DIA_SUSPENSION, DIAS_PROLONGADA };

// El concepto es texto libre, como lo emite la entidad (DA-47).
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

/**
 * Hito de control según la duración del certificado (DA-47, DA-49), con los mismos días que las alertas: el reporte
 * lista por duración y la columna «Día» dice en qué día va.
 */
export function hitoDe(dias) {
  if (dias > DIA_SUSPENSION) return { clave: 'mas_180', nombre: 'Más de 180 días' };
  if (dias >= DIA_AFP) return { clave: 'dia_150', nombre: 'Envío a la AFP (día 150)' };
  if (dias >= DIA_CONCEPTO) return { clave: 'dia_120', nombre: 'Concepto del día 120' };
  return { clave: 'mas_90', nombre: 'Más de 90 días' };
}

/** Estado del concepto de una prolongada: registrado, falta (ya avisada) o pendiente. */
export const estadoConcepto = (i) => (i.concepto != null ? 'registrado' : i.faltaConcepto ? 'falta' : 'pendiente');

const esProlongada = (i) => diasDelCaso(i) > DIAS_PROLONGADA;
const dias = (n) => (n === 1 ? '1 día' : `${n} días`);

// Pestañas del reporte (DA-49, opción A): «Requiere acción» va primero y es la de por defecto.
export const PESTANAS_PROLONGADAS = Object.freeze(['accion', 'espera', 'falta', 'con_concepto']);
const filtroDe = (pestana, hoy) =>
  ({
    accion: (i) => estadoConcepto(i) === 'pendiente' && llegoAlDia(i, DIA_CONCEPTO, hoy),
    espera: (i) => estadoConcepto(i) === 'pendiente' && !llegoAlDia(i, DIA_CONCEPTO, hoy),
    falta: (i) => estadoConcepto(i) === 'falta',
    con_concepto: (i) => estadoConcepto(i) === 'registrado',
  })[pestana];

const mensajeNoProlongada = (i) => `La incapacidad dura ${dias(diasDelCaso(i))}: el monitoreo es para las de más de ${DIAS_PROLONGADA} días.`;
// DA-50: un certificado con prórroga ya no es el vigente del caso.
const mensajeProrrogada = (i) => `El caso continúa en la prórroga n.º ${i.prorroga}: registre allí el concepto, la falta o la suspensión.`;
const mensajeAunNoEsDia120 = (i) =>
  diasDelCaso(i) < DIA_CONCEPTO
    ? `La incapacidad dura ${dias(diasDelCaso(i))}: no llega al día ${DIA_CONCEPTO}, cuando se pide el concepto de rehabilitación a la entidad.`
    : `La incapacidad llega al día ${DIA_CONCEPTO} el ${fechaBreve(fechaDelDia(i, DIA_CONCEPTO))}: desde ese día podrá registrar el concepto o su falta.`;
const mensajeConcepto = (i) => {
  if (i.tieneProrroga) return mensajeProrrogada(i);
  if (i.concepto != null) return 'Esta incapacidad ya tiene el concepto de rehabilitación registrado.';
  return esProlongada(i) ? mensajeAunNoEsDia120(i) : mensajeNoProlongada(i);
};
const mensajeFalta = (i) => {
  if (i.tieneProrroga) return mensajeProrrogada(i);
  if (i.concepto != null) return 'Esta incapacidad ya tiene el concepto de rehabilitación: no hay falta que registrar.';
  if (i.faltaConcepto) return 'Ya se registró la falta del concepto y se avisó al colaborador.';
  return esProlongada(i) ? mensajeAunNoEsDia120(i) : mensajeNoProlongada(i);
};
const mensajeSuspension = (i) => {
  if (i.tieneProrroga) return mensajeProrrogada(i);
  if (i.pagoSuspendido) return 'Ya se registró la suspensión del pago y se avisó al colaborador.';
  if (diasDelCaso(i) <= DIA_SUSPENSION) return `La incapacidad dura ${dias(diasDelCaso(i))}: el pago se suspende cuando supera los ${DIA_SUSPENSION} días.`;
  return `La incapacidad supera los ${DIA_SUSPENSION} días el ${fechaBreve(fechaDelDia(i, DIA_PENSION))}: desde ese día podrá registrar la suspensión del pago.`;
};

/** Lo que la Vista necesita saber de una prolongada hoy (DA-49). */
function situacion(i, hoy) {
  const llego120 = llegoAlDia(i, DIA_CONCEPTO, hoy);
  const llego181 = llegoAlDia(i, DIA_PENSION, hoy);
  // DA-50: solo el certificado vigente del caso admite registrar (la base exige tiene_prorroga = false).
  const vigente = !i.tieneProrroga;
  return {
    hito: hitoDe(diasDelCaso(i)),
    estadoConcepto: estadoConcepto(i),
    dia: diaActual(i, hoy),
    diasCaso: diasDelCaso(i),
    fechaDia120: fechaDelDia(i, DIA_CONCEPTO),
    fechaDia181: fechaDelDia(i, DIA_PENSION),
    hitoAlcanzado: llego120,
    vigente,
    puedeRegistrarConcepto: vigente && llego120 && i.concepto == null,
    puedeRegistrarFalta: vigente && llego120 && i.concepto == null && !i.faltaConcepto,
    // Desde el día 181 la incapacidad está en trámite de pensión (HU-21, DA-10); se muestra calculado, como HU-24.
    tramitePension: llego181,
    suspensionPendiente: vigente && llego181 && !i.pagoSuspendido,
    suspensionRegistrada: i.pagoSuspendido,
    mostrarSuspension: diasDelCaso(i) > DIA_SUSPENSION || i.pagoSuspendido,
  };
}

export function crearControlMonitoreo({ baseDeDatos, correo, hoy = hoyEnColombia }) {
  const leer = (id) => (esIdentificador(id) ? baseDeDatos.obtenerDatosProlongada(Number(id)) : null);

  return {
    /**
     * DS-10: consultarReporteProlongadas() — HU-22.CA1. Calcula en el momento (DA-19): las incapacidades de más de
     * 90 días por duración, las más largas primero, con el día en que van. Solo consulta.
     * @param {string} ver pestaña: accion, espera, falta o con_concepto (otra cosa = accion).
     */
    async consultarReporteProlongadas(ver = 'accion') {
      const fecha = hoy();
      const todas = (await baseDeDatos.consultarProlongadas(DIAS_PROLONGADA)).map((i) => ({ ...i, ...situacion(i, fecha) }));
      const pestana = PESTANAS_PROLONGADAS.includes(ver) ? ver : 'accion';
      return {
        ver: pestana,
        prolongadas: todas.filter(filtroDe(pestana, fecha)),
        conteos: Object.fromEntries(PESTANAS_PROLONGADAS.map((clave) => [clave, todas.filter(filtroDe(clave, fecha)).length])),
      };
    },

    /**
     * Datos de la pantalla de una prolongada. Solo consulta. null si no existe o no es prolongada. Si el certificado ya
     * tiene prórroga (DA-50), `{ continuaEn }`: el caso se monitorea en la prórroga.
     */
    async prepararProlongada(idIncapacidad) {
      const incapacidad = await leer(idIncapacidad);
      if (incapacidad?.tieneProrroga && incapacidad.prorroga) return { continuaEn: incapacidad.prorroga };
      if (!incapacidad || !esProlongada(incapacidad)) return null;
      return { incapacidad, ...situacion(incapacidad, hoy()) };
    },

    /**
     * DS-10: registrarConcepto(concepto) → guardarConcepto(concepto) → comunicarConcepto() — HU-22.CA2.
     * Solo desde el día 120 (DA-49). Primero se guarda (condicionado en la base, con la misma regla) y solo entonces
     * se avisa al colaborador: si otro usuario lo registró a la vez no sale un correo de más; si el correo falla, se
     * deshace y se puede reintentar.
     * @param {{ concepto?: string }} datos
     * @param {{ id: string }} usuario quien lo registra (DA-23).
     * @returns {Promise<null | { idIncapacidad: number }>} null si no existe.
     * @throws {ErrorDeValidacion} concepto no válido (`concepto`), o no admite concepto (`estado`).
     * @throws {import('./error-de-aviso.js').ErrorDeAviso} el correo falló.
     */
    async registrarConcepto(idIncapacidad, datos, usuario) {
      const actual = await leer(idIncapacidad);
      if (!actual) return null;
      const fecha = hoy();
      if (!situacion(actual, fecha).puedeRegistrarConcepto) throw new ErrorDeValidacion({ estado: mensajeConcepto(actual) });
      const concepto = leerConcepto(datos?.concepto);
      if (concepto.error) throw new ErrorDeValidacion({ concepto: concepto.error });

      const guardado = await baseDeDatos.guardarConcepto(actual.idIncapacidad, concepto.valor, condicionDelDia(DIA_CONCEPTO, fecha), usuario.id);
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
     * que la entidad no emitió el concepto y avisa al colaborador (mismo orden y regla que registrarConcepto).
     * @param {{ id: string }} usuario quien la registra (DA-23).
     * @returns {Promise<null | { idIncapacidad: number }>} null si no existe.
     * @throws {ErrorDeValidacion} no admite registrar la falta (`estado`).
     * @throws {import('./error-de-aviso.js').ErrorDeAviso} el correo falló.
     */
    async registrarFaltaConcepto(idIncapacidad, usuario) {
      const actual = await leer(idIncapacidad);
      if (!actual) return null;
      const fecha = hoy();
      if (!situacion(actual, fecha).puedeRegistrarFalta) throw new ErrorDeValidacion({ estado: mensajeFalta(actual) });

      const guardado = await baseDeDatos.guardarFaltaConcepto(actual.idIncapacidad, condicionDelDia(DIA_CONCEPTO, fecha), usuario.id);
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
     * DS-10: registrarSuspensionPago() → guardarSuspensionPago() → notificarSuspensionPago() — HU-24.CA1. Solo si la
     * incapacidad supera 180 días y ya llegó al día 181 (DA-49), y no se registró antes; primero se guarda y luego se
     * avisa al colaborador (mismo orden que el concepto). El reintegro de pagos de más de 180 días se gestiona fuera de SIGI.
     * @param {{ id: string }} usuario quien la registra (DA-23).
     * @returns {Promise<null | { idIncapacidad: number }>} null si no existe.
     * @throws {ErrorDeValidacion} no admite la suspensión (`suspension`).
     * @throws {import('./error-de-aviso.js').ErrorDeAviso} el correo falló.
     */
    async registrarSuspensionPago(idIncapacidad, usuario) {
      const actual = await leer(idIncapacidad);
      if (!actual) return null;
      const fecha = hoy();
      if (!situacion(actual, fecha).suspensionPendiente) throw new ErrorDeValidacion({ suspension: mensajeSuspension(actual) });

      const guardado = await baseDeDatos.guardarSuspensionPago(actual.idIncapacidad, condicionDelDia(DIA_PENSION, fecha), usuario.id);
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
