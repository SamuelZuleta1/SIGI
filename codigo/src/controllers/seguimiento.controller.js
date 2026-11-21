// Grupo `seguimiento` del Control de incapacidades — DS-07 (CU-11).
// Operaciones: consultarPendientesDePago → obtenerPendientes (HU-16.CA1), prepararSeguimiento (apoyo de la Vista),
// registrarSeguimiento con evaluarDemora (HU-16.CA3). El pago que se conoce en el seguimiento usa
// cobro.registrarPago (HU-16.CA2, HU-15.CA2).
import { diasCalendario, fechaEnColombia, hoyEnColombia } from '../servicios/dias-habiles.js';
import { leerEvidencia } from './archivo.js';
import { fechaPrometida } from './cobro.controller.js';
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

export function crearControlSeguimiento({ baseDeDatos, hoy = hoyEnColombia }) {
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
     */
    async registrarSeguimiento(idIncapacidad, datos, usuario) {
      const actual = esIdentificador(idIncapacidad) ? await baseDeDatos.obtenerDatosSeguimiento(Number(idIncapacidad)) : null;
      if (!actual) return null;
      if (!estaPendienteDePago(actual)) throw new ErrorDeValidacion({ estado: mensajeEstado(actual) });

      const evidencia = leerEvidencia(datos?.evidencia, 'Adjunte la evidencia de la gestión (correo, pantallazo o respuesta de la entidad).');
      if (evidencia.error) throw new ErrorDeValidacion({ evidencia: evidencia.error });

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
      const demora = evaluarDemora(actual, hoy());
      return { idIncapacidad: actual.idIncapacidad, idSeguimiento, demora };
    },

    /** Datos de un seguimiento (sin el archivo), o null si no existe. */
    async obtenerSeguimiento(idSeguimiento) {
      if (!esIdentificador(idSeguimiento)) return null;
      return baseDeDatos.consultarSeguimiento(Number(idSeguimiento));
    },

    /** «Ver evidencia» del seguimiento: el archivo lo entrega el servidor (como DA-06). */
    async verEvidenciaSeguimiento(seguimiento) {
      const { contenido, tipoMime } = await baseDeDatos.descargarEvidencia(seguimiento.evidencia);
      const extension = seguimiento.evidencia.split('.').pop();
      return { contenido, tipoMime, nombre: `seguimiento-${seguimiento.idSeguimiento}.${extension}` };
    },
  };
}
