// Grupo `radicacion` del Control de incapacidades — DS-04 (CU-06).
// Operaciones: prepararRadicacion (HU-09) con calcularPlazoRadicacion, registrarRadicacion (HU-10)
// y «ver evidencia».
import { z } from 'zod';
import { diasCalendario, hoyEnColombia, sumarIntervalo } from '../servicios/dias-habiles.js';
import { TAMANO_MAXIMO_ARCHIVO, tipoDeArchivo } from './archivo.js';
import { ErrorDeValidacion } from './error-de-validacion.js';
import { esIdentificador } from './identificador.js';

// «Por vencer» = 5 días calendario antes del vencimiento (DA-13).
export const DIAS_POR_VENCER = 5;

// Licencia de paternidad: 30 días calendario desde el nacimiento, en todas las EPS (DA-13).
// Sin fecha de nacimiento registrada se cuenta desde el inicio de la licencia (DA-35).
export const PLAZO_PATERNIDAD = Object.freeze({ dias: 30 });

const UNIDADES = { year: 'anios', years: 'anios', mon: 'meses', mons: 'meses', day: 'dias', days: 'dias' };

/**
 * Lee el `interval` de Postgres tal como lo entrega Supabase («1 year», «150 days», «1 year 2 mons»).
 * @returns {null | { anios: number, meses: number, dias: number }} null si no hay plazo.
 */
export function leerIntervalo(texto) {
  if (typeof texto !== 'string') return null;
  const intervalo = { anios: 0, meses: 0, dias: 0 };
  for (const [, cantidad, unidad] of texto.matchAll(/(-?\d+)\s+(years?|mons?|days?)\b/g)) {
    intervalo[UNIDADES[unidad]] += Number(cantidad);
  }
  const { anios, meses, dias } = intervalo;
  return anios > 0 || meses > 0 || dias > 0 ? intervalo : null;
}

const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

/** «12 meses», «3 años», «150 días», «1 año y 2 meses»: como lo dice el procedimiento (§5.2.1). */
export function describirIntervalo({ anios, meses, dias }) {
  const totalMeses = anios * 12 + meses;
  const partes =
    anios > 0 && (meses > 0 || anios === 1)
      ? [totalMeses > 0 && plural(totalMeses, 'mes', 'meses')]
      : [anios > 0 && plural(anios, 'año', 'años'), meses > 0 && plural(meses, 'mes', 'meses')];
  partes.push(dias > 0 && plural(dias, 'día', 'días'));
  return partes.filter(Boolean).join(' y ');
}

/**
 * DS-04: calcularPlazoRadicacion(). Fecha límite para radicar y su estado (DA-13, DA-17).
 * - Paternidad: nacimiento (o inicio) + 30 días.
 * - Accidente de tránsito en una entidad con plazo propio de tránsito (Salud Total, 15 días; P-C).
 * - Los demás: inicio + plazo de transcripción de la entidad.
 * La entidad tiene todo el día límite; desde el día siguiente está vencido (como DA-32).
 * @returns {null | object} null si la entidad no tiene plazo registrado.
 */
export function calcularPlazoRadicacion(incapacidad, entidad, hoy) {
  let regla;
  let intervalo;
  let desde = incapacidad.fechaInicio;
  let base = 'inicio';
  if (incapacidad.tipo === 'licencia_paternidad') {
    regla = 'paternidad';
    intervalo = PLAZO_PATERNIDAD;
    if (incapacidad.fechaNacimiento) [desde, base] = [incapacidad.fechaNacimiento, 'nacimiento'];
  } else if (incapacidad.tipo === 'accidente_transito' && leerIntervalo(entidad.plazoTranscripcionTransito)) {
    regla = 'transito';
    intervalo = leerIntervalo(entidad.plazoTranscripcionTransito);
  } else {
    regla = 'entidad';
    intervalo = leerIntervalo(entidad.plazoTranscripcion);
  }
  if (!intervalo) return null;

  const fechaLimite = sumarIntervalo(desde, intervalo);
  const diasRestantes = diasCalendario(hoy, fechaLimite);
  const estado = diasRestantes < 0 ? 'vencido' : diasRestantes <= DIAS_POR_VENCER ? 'por_vencer' : 'al_dia';
  return {
    regla,
    duracion: describirIntervalo({ anios: 0, meses: 0, dias: 0, ...intervalo }),
    desde,
    base,
    fechaLimite,
    diasTotales: diasCalendario(desde, fechaLimite),
    diasRestantes,
    estado,
  };
}

// EST-01 (DA-01, DA-36): se radica desde «registrada» (sin estado) o, tras un rechazo, desde «rechazada».
// Auditoría (decisión 4A, DA-70): una rechazada ya trasladada a Cartera y Jurídica no se radica de nuevo: su cobro
// sigue por vía jurídica.
export const puedeRadicar = (estado, motivoTraslado = null) => (estado == null || estado === 'rechazada') && motivoTraslado == null;
const MENSAJE_TRASLADADA = 'La incapacidad ya se trasladó a Cartera y Jurídica: su cobro sigue por vía jurídica y no se radica de nuevo.';

const NOMBRES_ESTADO = { transcrita: 'ya está radicada (transcrita)', cobrada: 'ya está cobrada', pagada: 'ya está pagada' };
const mensajeEstado = (estado) =>
  `La incapacidad ${NOMBRES_ESTADO[estado] ?? 'no admite una radicación'}: solo se radica una nueva tras un rechazo.`;

export const LARGO_MAXIMO_RADICADO = 100;
const numeroDeRadicado = z
  .string({ error: 'Escriba el número de radicado.' })
  .trim()
  .min(1, 'Escriba el número de radicado.')
  .max(LARGO_MAXIMO_RADICADO, `El número de radicado admite máximo ${LARGO_MAXIMO_RADICADO} caracteres.`);

export function crearControlRadicacion({ baseDeDatos, hoy = hoyEnColombia }) {
  return {
    /**
     * DS-04: prepararRadicacion(idIncapacidad) → obtenerDatosRadicacion → calcularPlazoRadicacion()
     * → datosRadicacion(entidad, plazo, estado del plazo, canal) (HU-09.CA1, DA-17).
     * Solo consulta. Las advertencias (plazo por vencer o vencido, documentación sin verificar) no
     * impiden radicar (HU-09.CA2, DA-14).
     * @returns {Promise<null | object>} null si la incapacidad no existe.
     */
    async prepararRadicacion(idIncapacidad) {
      const datos = esIdentificador(idIncapacidad) ? await baseDeDatos.obtenerDatosRadicacion(Number(idIncapacidad)) : null;
      if (!datos) return null;
      const { entidad, ...incapacidad } = datos;
      const fechaHoy = hoy();
      return {
        incapacidad,
        entidad: { nombre: entidad.nombre, tipo: entidad.tipo, permiteTranscripcionDigital: entidad.permiteTranscripcionDigital },
        plazo: calcularPlazoRadicacion(incapacidad, entidad, fechaHoy),
        hoy: fechaHoy,
        // DA-14: radicar sin la documentación verificada se advierte y se permite.
        sinVerificar: !incapacidad.archivadoDigital,
        puedeRadicar: puedeRadicar(incapacidad.estado, incapacidad.motivoTraslado),
      };
    },

    /**
     * DS-04: registrarRadicacion(radicado, evidencia) → guardarRadicacion — HU-10.
     * Guarda el número de radicado y la evidencia (archivo PDF, JPG o PNG; P-D) y pone la incapacidad
     * en «transcrita» (DA-01). Tras un rechazo se registra una nueva y vuelve a «transcrita» (HU-10.CA2).
     * Las advertencias del plazo no bloquean (DA-14); el estado sí (DA-36).
     * @param {{ radicado?: string, evidencia?: Buffer }} datos
     * @returns {Promise<null | { idIncapacidad: number, idRadicacion: number }>} null si la incapacidad no existe.
     * @throws {ErrorDeValidacion} datos no válidos, o el estado no admite radicar (`estado`).
     */
    async registrarRadicacion(idIncapacidad, datos, usuario) {
      const actual = esIdentificador(idIncapacidad) ? await baseDeDatos.obtenerDatosRadicacion(Number(idIncapacidad)) : null;
      if (!actual) return null;
      if (actual.motivoTraslado != null) throw new ErrorDeValidacion({ estado: MENSAJE_TRASLADADA });
      if (!puedeRadicar(actual.estado)) throw new ErrorDeValidacion({ estado: mensajeEstado(actual.estado) });

      const errores = {};
      const radicado = numeroDeRadicado.safeParse(datos?.radicado);
      if (!radicado.success) errores.radicado = radicado.error.issues[0].message;
      const contenido = datos?.evidencia;
      const tipoMime = Buffer.isBuffer(contenido) ? tipoDeArchivo(contenido) : null;
      if (!Buffer.isBuffer(contenido) || contenido.length === 0) errores.evidencia = 'Adjunte la evidencia de la radicación.';
      else if (contenido.length > TAMANO_MAXIMO_ARCHIVO) errores.evidencia = 'El archivo pesa más de 10 MB.';
      else if (!tipoMime) errores.evidencia = 'La evidencia debe ser PDF, JPG o PNG.';
      if (Object.keys(errores).length > 0) throw new ErrorDeValidacion(errores);

      const idRadicacion = await baseDeDatos.guardarRadicacion(
        actual.idIncapacidad,
        { radicado: radicado.data, contenido, tipoMime },
        usuario.id,
      );
      // Otro usuario la radicó entre la consulta y el registro: la transacción no la repitió.
      if (idRadicacion == null) {
        const ahora = await baseDeDatos.obtenerDatosRadicacion(actual.idIncapacidad);
        throw new ErrorDeValidacion({ estado: ahora?.motivoTraslado != null ? MENSAJE_TRASLADADA : mensajeEstado('transcrita') });
      }
      return { idIncapacidad: actual.idIncapacidad, idRadicacion };
    },

    /** Datos de una radicación (sin el archivo), o null si no existe o no tiene evidencia. */
    async obtenerRadicacion(idRadicacion) {
      if (!esIdentificador(idRadicacion)) return null;
      const radicacion = await baseDeDatos.consultarRadicacion(Number(idRadicacion));
      return radicacion?.evidencia ? radicacion : null;
    },

    /** «Ver evidencia»: el archivo lo entrega el servidor, nunca el bucket al navegador (como DA-06). */
    async verEvidencia(radicacion) {
      const { contenido, tipoMime } = await baseDeDatos.descargarEvidencia(radicacion.evidencia);
      const extension = radicacion.evidencia.split('.').pop();
      return { contenido, tipoMime, nombre: `radicacion-${radicacion.idRadicacion}.${extension}` };
    },
  };
}
