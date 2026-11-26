// Grupo `seguimiento` del Control de incapacidades — DS-07 (CU-11).
// Operaciones: consultarPendientesDePago → obtenerPendientes (HU-16.CA1), prepararSeguimiento (apoyo de la Vista),
// registrarSeguimiento con evaluarDemora (HU-16.CA3) y notificarRetraso (HU-17.CA1), registrarAcuerdo (HU-17.CA2).
// El pago que se conoce en el seguimiento usa cobro.registrarPago (HU-16.CA2, HU-15.CA2).
import { diasCalendario, fechaBreve, fechaEnColombia, hoyEnColombia, sumarIntervalo } from '../servicios/dias-habiles.js';
import { leerEvidencia } from './archivo.js';
import { fechaPrometida, leerValor } from './cobro.controller.js';
import { ErrorDeAviso, resumirError } from './error-de-aviso.js';
import { ErrorDeValidacion } from './error-de-validacion.js';
import { esIdentificador } from './identificador.js';

// DA-41: el seguimiento es semanal. Toca esta semana si pasaron 7 días o más desde el último seguimiento o, si
// aún no hay ninguno, desde que quedó cobrada (recién aprobada no tiene nada que seguir todavía).
export const DIAS_ENTRE_SEGUIMIENTOS = 7;

/**
 * DS-07: evaluarDemora() — HU-16.CA3. Compara hoy con la fecha prometida (fecha_cobrada + tiempo_pago, DA-38).
 * La entidad tiene todo el día prometido: hay demora desde el día siguiente.
 * @returns {{ fechaPrometida: string, conDemora: boolean, diasDemora: number, diasRestantes: number }}
 */
export function evaluarDemora({ fechaCobrada, tiempoPago }, hoy) {
  const prometida = fechaPrometida(fechaCobrada, tiempoPago);
  const diferencia = diasCalendario(prometida, hoy);
  return {
    fechaPrometida: prometida,
    conDemora: diferencia > 0,
    diasDemora: Math.max(diferencia, 0),
    diasRestantes: Math.max(-diferencia, 0),
  };
}

/**
 * ¿Toca el seguimiento de esta semana? (DA-41)
 * @param {string | null} ultimo fecha del último seguimiento (AAAA-MM-DD), o null si no hay.
 * @param {string} fechaCobrada desde cuándo se cuenta si no hay seguimientos.
 */
export const tocaSeguimiento = (ultimo, fechaCobrada, hoy) =>
  diasCalendario(ultimo ?? fechaCobrada, hoy) >= DIAS_ENTRE_SEGUIMIENTOS;

// DA-18: las dadas de baja no están pendientes de pago. EST-01: solo las cobradas.
export const estaPendienteDePago = ({ estado, decision }) => estado === 'cobrada' && decision !== 'dar_de_baja';

// Pestañas de la lista (DA-41): todas, con demora y las que no tienen seguimiento esta semana.
export const FILTROS_PENDIENTES = Object.freeze({
  todas: () => true,
  demora: (p) => p.conDemora,
  semana: (p) => p.tocaSeguimiento,
});

// DA-42: el acuerdo es una fecha de pago futura o reciente; hasta un año desde hoy.
export const ACUERDO_DIAS_MAXIMO = 365;

const esFechaValida = (valor) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor) || valor < '0001-01-01') return false;
  const fecha = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().startsWith(valor);
};

/**
 * Valida la fecha del acuerdo de pago (DA-42): no anterior a la fecha en que quedó cobrada ni más de un año después de hoy.
 * @returns {{ valor?: string, error?: string }}
 */
export function leerFechaAcuerdo(texto, { hoy, fechaCobrada }) {
  const limpio = typeof texto === 'string' ? texto.trim() : '';
  if (limpio === '') return { error: 'Escriba la fecha en que la entidad se comprometió a pagar.' };
  if (!esFechaValida(limpio)) return { error: 'Escriba una fecha válida (día, mes y año).' };
  if (limpio < fechaCobrada) return { error: `La fecha no puede ser anterior a la aprobación del cobro (${fechaBreve(fechaCobrada)}).` };
  if (limpio > sumarIntervalo(hoy, { dias: ACUERDO_DIAS_MAXIMO })) return { error: 'La fecha no puede ser más de un año después de hoy.' };
  return { valor: limpio };
}

const MENSAJES_ESTADO = {
  null: 'La incapacidad aún no se ha radicado: no tiene cobro que seguir.',
  transcrita: 'La entidad aún no ha aprobado la incapacidad: regístrela como cobrada antes del seguimiento.',
  rechazada: 'La entidad rechazó la incapacidad: debe radicarse de nuevo.',
  pagada: 'La incapacidad ya está pagada: no necesita seguimiento.',
};
const mensajeEstado = (incapacidad) =>
  incapacidad?.decision === 'dar_de_baja'
    ? 'Cartera y Jurídica dio de baja esta acreencia: ya no tiene seguimiento.'
    : (MENSAJES_ESTADO[incapacidad?.estado ?? 'null'] ?? 'La incapacidad no admite seguimiento.');

export function crearControlSeguimiento({ baseDeDatos, correo, hoy = hoyEnColombia }) {
  return {
    /**
     * DS-07: consultarPendientesDePago → obtenerPendientes → consultarCobradas — HU-16.CA1. Las cobradas sin las
     * dadas de baja (DA-18), con la demora evaluada y el último seguimiento: primero las de más demora, luego las
     * que vencen antes. Solo consulta.
     * @param {string} ver pestaña: todas, demora o semana (otra cosa = todas).
     */
    async consultarPendientesDePago(ver = 'todas') {
      const fecha = hoy();
      const pendientes = (await baseDeDatos.consultarCobradas())
        .filter(estaPendienteDePago)
        .map((incapacidad) => {
          const ultimo = incapacidad.ultimoSeguimiento ? fechaEnColombia(incapacidad.ultimoSeguimiento) : null;
          return {
            ...incapacidad,
            ultimoSeguimiento: ultimo,
            ...evaluarDemora(incapacidad, fecha),
            tocaSeguimiento: tocaSeguimiento(ultimo, incapacidad.fechaCobrada, fecha),
          };
        })
        .sort((a, b) => a.fechaPrometida.localeCompare(b.fechaPrometida) || a.idIncapacidad - b.idIncapacidad);
      const pestana = Object.hasOwn(FILTROS_PENDIENTES, ver) ? ver : 'todas';
      return {
        hoy: fecha,
        ver: pestana,
        pendientes: pendientes.filter(FILTROS_PENDIENTES[pestana]),
        conteos: Object.fromEntries(Object.entries(FILTROS_PENDIENTES).map(([clave, f]) => [clave, pendientes.filter(f).length])),
      };
    },

    /** Datos de la pantalla de seguimiento de una incapacidad. Solo consulta. null si no existe. */
    async prepararSeguimiento(idIncapacidad) {
      const incapacidad = esIdentificador(idIncapacidad) ? await baseDeDatos.obtenerDatosSeguimiento(Number(idIncapacidad)) : null;
      if (!incapacidad) return null;
      const fecha = hoy();
      const pendiente = estaPendienteDePago(incapacidad);
      const cobrada = incapacidad.tiempoPago != null && incapacidad.fechaCobrada != null;
      // Cada seguimiento con la demora que había el día en que se registró (para la línea de tiempo).
      const seguimientos = incapacidad.seguimientos.map((s) => {
        const dia = fechaEnColombia(s.fecha);
        return { ...s, dia, diasDemora: cobrada ? evaluarDemora(incapacidad, dia).diasDemora : 0 };
      });
      return {
        incapacidad: { ...incapacidad, seguimientos },
        hoy: fecha,
        pendiente,
        demora: cobrada ? evaluarDemora(incapacidad, fecha) : null,
        // DS-07 (opt): el acuerdo se registra cuando el pago supera el tiempo prometido (DA-42).
        puedeRegistrarAcuerdo: pendiente && cobrada && evaluarDemora(incapacidad, fecha).conDemora,
        tocaSeguimiento: pendiente && tocaSeguimiento(seguimientos.at(-1)?.dia ?? null, incapacidad.fechaCobrada, fecha),
        mensajeEstado: pendiente ? null : mensajeEstado(incapacidad),
      };
    },

    /**
     * DS-07: registrarSeguimiento(evidencia) → guardarSeguimiento(evidencia) → evaluarDemora() — HU-16.CA3.
     * La evidencia de la gestión es un archivo (PDF, JPG o PNG; P-D) en el bucket privado.
     * @param {{ evidencia?: Buffer }} datos
     * @param {{ id: string }} usuario
     * @returns {Promise<null | { idIncapacidad: number, idSeguimiento: number, demora: ReturnType<typeof evaluarDemora> }>}
     *   null si la incapacidad no existe.
     * @throws {ErrorDeValidacion} evidencia no válida, o la incapacidad no está pendiente de pago (`estado`).
     * @throws {ErrorDeAviso} con demora, el aviso de retraso a la Coordinación falló (no se guardó nada).
     */
    async registrarSeguimiento(idIncapacidad, datos, usuario) {
      const actual = esIdentificador(idIncapacidad) ? await baseDeDatos.obtenerDatosSeguimiento(Number(idIncapacidad)) : null;
      if (!actual) return null;
      if (!estaPendienteDePago(actual)) throw new ErrorDeValidacion({ estado: mensajeEstado(actual) });

      const evidencia = leerEvidencia(datos?.evidencia, 'Adjunte la evidencia de la gestión (correo, pantallazo o respuesta de la entidad).');
      if (evidencia.error) throw new ErrorDeValidacion({ evidencia: evidencia.error });

      // DS-07 evaluarDemora → opt [el pago supera el tiempo prometido] → notificarRetraso (HU-17.CA1). Como los demás
      // avisos (DA-31, HU-08), primero el correo y después el registro: si el correo falla, no queda un seguimiento
      // «con demora» sin aviso y el auxiliar puede intentarlo de nuevo (DA-42).
      const demora = evaluarDemora(actual, hoy());
      // Si el aviso falla, todavía no se guardó nada: ErrorDeAviso con `deshecho` (la ruta responde 502 y se reintenta).
      if (demora.conDemora) {
        try {
          await correo.notificarRetraso({ ...actual, fechaPrometida: demora.fechaPrometida, diasDemora: demora.diasDemora });
        } catch (causa) {
          console.error('[registrarSeguimiento] El aviso de retraso falló; no se guardó nada', {
            idIncapacidad: actual.idIncapacidad,
            errorCorreo: resumirError(causa),
          });
          throw new ErrorDeAviso({ operacion: 'retraso', idIncapacidad: actual.idIncapacidad, deshecho: true, causa });
        }
      }

      const idSeguimiento = await baseDeDatos.guardarSeguimiento(
        actual.idIncapacidad,
        { contenido: datos.evidencia, tipoMime: evidencia.tipoMime },
        usuario.id,
      );
      // Otro usuario registró el pago (o la baja) entre la consulta y el registro: la transacción no lo guardó.
      if (idSeguimiento == null) {
        const ahora = await baseDeDatos.obtenerDatosSeguimiento(actual.idIncapacidad);
        throw new ErrorDeValidacion({ estado: mensajeEstado(ahora ?? actual) });
      }
      return { idIncapacidad: actual.idIncapacidad, idSeguimiento, demora, avisoRetraso: demora.conDemora };
    },

    /**
     * DS-07: registrarAcuerdo(acuerdo) → guardarAcuerdo(acuerdo) — HU-17.CA2. La fecha y el valor que la Coordinación
     * acordó con la entidad. Solo con la incapacidad pendiente de pago y en demora (DA-42).
     * @param {{ fecha?: string, valor?: string }} datos
     * @param {{ id: string }} usuario
     * @returns {Promise<null | { idIncapacidad: number, idAcuerdo: number }>} null si la incapacidad no existe.
     * @throws {ErrorDeValidacion} fecha o valor no válidos, o no admite acuerdo (`estado`).
     */
    async registrarAcuerdo(idIncapacidad, datos, usuario) {
      const actual = esIdentificador(idIncapacidad) ? await baseDeDatos.obtenerDatosSeguimiento(Number(idIncapacidad)) : null;
      if (!actual) return null;
      if (!estaPendienteDePago(actual)) throw new ErrorDeValidacion({ estado: mensajeEstado(actual) });
      const fecha = hoy();
      const demora = evaluarDemora(actual, fecha);
      if (!demora.conDemora) {
        throw new ErrorDeValidacion({
          estado: `La entidad aún está dentro del plazo (hasta el ${fechaBreve(demora.fechaPrometida)}): el acuerdo se registra cuando hay demora.`,
        });
      }

      const fechaAcuerdo = leerFechaAcuerdo(datos?.fecha, { hoy: fecha, fechaCobrada: actual.fechaCobrada });
      const valor = leerValor(datos?.valor);
      const errores = {};
      if (fechaAcuerdo.error) errores.fechaAcuerdo = fechaAcuerdo.error;
      if (valor.error) errores.valorAcuerdo = valor.error;
      if (Object.keys(errores).length) throw new ErrorDeValidacion(errores);

      const idAcuerdo = await baseDeDatos.guardarAcuerdo(actual.idIncapacidad, { fecha: fechaAcuerdo.valor, valor: valor.valor }, usuario.id);
      // Otro usuario registró el pago (o la baja) entre la consulta y el registro: la transacción no lo guardó.
      if (idAcuerdo == null) {
        const ahora = await baseDeDatos.obtenerDatosSeguimiento(actual.idIncapacidad);
        throw new ErrorDeValidacion({ estado: mensajeEstado(ahora ?? actual) });
      }
      return { idIncapacidad: actual.idIncapacidad, idAcuerdo };
    },

    /** Datos de un seguimiento (sin el archivo), o null si no existe. */
    async obtenerSeguimiento(idSeguimiento) {
      if (!esIdentificador(idSeguimiento)) return null;
      return baseDeDatos.consultarSeguimiento(Number(idSeguimiento));
    },

    /** «Ver evidencia» del seguimiento (DA-71): enlace firmado de 60 s al bucket privado, o null si el archivo no está. */
    async verEvidenciaSeguimiento(seguimiento) {
      const url = await baseDeDatos.enlaceDeArchivo(seguimiento.evidencia);
      return url && { url };
    },
  };
}
