// Grupo `reportes` del Control de incapacidades — DS-12 (CU-16).
// Operación: generarReporte(tipo, periodo) → consultarDatosReporte → consolidarDatos() → guardarReporte(tipo) →
// enviarReporteAusentismo (HU-27, DA-21, DA-57). Apoyo de la Vista: prepararReportes y consultarReporte.
// El reporte de prolongadas (alternativa A1, clasificarPorHito) llega con HU-28 (T-28).
import { avisarODeshacer } from './error-de-aviso.js';
import { ErrorDeValidacion } from './error-de-validacion.js';
import { diasCalendario, hoyEnColombia, sumarIntervalo } from '../servicios/dias-habiles.js';

// DA-57: el primer periodo que se puede pedir (antes no hay datos en SIGI) y cuántos reportes recientes se listan.
export const PERIODO_MINIMO = '2020-01';
export const REPORTES_RECIENTES = 12;
// Un reporte igual del mismo mes generado hace menos de esto es un doble envío (doble clic sin JavaScript): no se
// guarda otro ni se vuelve a enviar.
export const DOBLE_ENVIO_MS = 2 * 60 * 1000;

const PERIODO = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** El mes (AAAA-MM) de una fecha AAAA-MM-DD. */
const mesDe = (fecha) => fecha.slice(0, 7);

/** El mes anterior al de `hoy` (AAAA-MM-DD): el que se entrega al SG-SST en los primeros 3 días de cada mes. */
export const periodoAnterior = (hoy) => mesDe(sumarIntervalo(`${mesDe(hoy)}-01`, { meses: -1 }));

/** Primer y último día del periodo AAAA-MM. */
export function limitesDelPeriodo(periodo) {
  const desde = `${periodo}-01`;
  return { desde, hasta: sumarIntervalo(sumarIntervalo(desde, { meses: 1 }), { dias: -1 }) };
}

/**
 * El periodo pedido: AAAA-MM entre PERIODO_MINIMO y el mes en curso (el mes en curso sale con los días que lleva).
 * @returns {{ valor?: string, error?: string }}
 */
export function leerPeriodo(texto, hoy = hoyEnColombia()) {
  const limpio = typeof texto === 'string' ? texto.trim() : '';
  if (limpio === '') return { error: 'Elija el mes del reporte.' };
  if (!PERIODO.test(limpio)) return { error: 'Escriba el mes como AAAA-MM, por ejemplo 2026-10.' };
  if (limpio < PERIODO_MINIMO) return { error: `Elija un mes desde ${PERIODO_MINIMO}.` };
  if (limpio > mesDe(hoy)) return { error: 'El mes del reporte no puede ser futuro.' };
  return { valor: limpio };
}

/**
 * DS-12: consolidarDatos() — HU-27, DA-21, DA-57. Las incapacidades del periodo son las que tienen al menos un día
 * dentro del mes (empiezan antes y siguen, o empiezan en él). De cada una: colaborador, tipo, entidad, fecha de inicio,
 * días (los del certificado y los que caen dentro del periodo) y estado. Ordenadas por fecha de inicio.
 * @param {{ idIncapacidad, colaborador, tipo, entidad, fechaInicio, diasIncapacidad, estado }[]} incapacidades
 * @param {string} periodo AAAA-MM
 */
export function consolidarDatos(incapacidades, periodo) {
  const { desde, hasta } = limitesDelPeriodo(periodo);
  return incapacidades
    .map((i) => ({ ...i, fechaFin: sumarIntervalo(i.fechaInicio, { dias: i.diasIncapacidad - 1 }) }))
    .filter((i) => i.fechaInicio <= hasta && i.fechaFin >= desde)
    .sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio) || a.idIncapacidad - b.idIncapacidad)
    .map((i) => {
      const inicio = i.fechaInicio > desde ? i.fechaInicio : desde;
      const fin = i.fechaFin < hasta ? i.fechaFin : hasta;
      return {
        idIncapacidad: i.idIncapacidad,
        idColaborador: i.idColaborador,
        colaborador: i.colaborador,
        tipo: i.tipo,
        entidad: i.entidad,
        fechaInicio: i.fechaInicio,
        fechaFin: i.fechaFin,
        diasIncapacidad: i.diasIncapacidad,
        diasEnPeriodo: diasCalendario(inicio, fin) + 1,
        estado: i.estado ?? 'registrada',
      };
    });
}

/** Totales del reporte: incapacidades, colaboradores distintos (por id, no por nombre) y días de ausencia dentro del periodo. */
export function totalesDelReporte(contenido) {
  return {
    incapacidades: contenido.length,
    colaboradores: new Set(contenido.map((f) => f.idColaborador ?? f.colaborador)).size,
    diasEnPeriodo: contenido.reduce((s, f) => s + f.diasEnPeriodo, 0),
  };
}

/** Lo que identifica el contenido de un reporte, sin depender del orden de las claves (jsonb las reordena). */
const firma = (contenido) =>
  JSON.stringify(contenido.map((f) => [f.idIncapacidad, f.colaborador, f.tipo, f.entidad, f.fechaInicio, f.diasIncapacidad, f.diasEnPeriodo, f.estado]));

/** Días de ausencia por tipo de incapacidad, de más a menos días. */
export function diasPorTipo(contenido) {
  const tipos = new Map();
  for (const f of contenido) {
    const t = tipos.get(f.tipo) ?? { tipo: f.tipo, incapacidades: 0, dias: 0 };
    t.incapacidades += 1;
    t.dias += f.diasEnPeriodo;
    tipos.set(f.tipo, t);
  }
  return [...tipos.values()].sort((a, b) => b.dias - a.dias || a.tipo.localeCompare(b.tipo));
}

export function crearControlReportes({ baseDeDatos, correo, ahora = Date.now }) {
  return {
    /** Apoyo de la Vista: el mes sugerido (el anterior), el mes en curso (máximo) y los reportes recientes. */
    async prepararReportes(hoy = hoyEnColombia()) {
      return {
        periodoSugerido: periodoAnterior(hoy),
        periodoMinimo: PERIODO_MINIMO,
        periodoMaximo: mesDe(hoy),
        recientes: await baseDeDatos.consultarReportes('ausentismo', REPORTES_RECIENTES),
      };
    },

    /** Apoyo de la Vista: un reporte guardado; null si no existe. */
    async consultarReporte(id) {
      return baseDeDatos.consultarReporte(id);
    },

    /**
     * DS-12: generarReporte(tipo, periodo) — HU-27 (tipo «ausentismo»). Consulta las incapacidades, consolida las
     * del periodo, guarda el reporte con su contenido (DA-21; DA-23: quién lo generó) y lo envía al SG-SST. Si el
     * correo falla, borra el reporte y se puede reintentar (DA-44/DA-47). Un periodo sin incapacidades no se guarda.
     * @param {{ periodo?: string }} datos
     * @param {{ id: string }} usuario
     * @returns {Promise<{ idReporte: number, periodo: string, cantidad: number }>}
     * @throws {ErrorDeValidacion} | {ErrorDeAviso}
     */
    async generarReporte(tipo, datos, usuario, hoy = hoyEnColombia()) {
      if (tipo !== 'ausentismo') throw new Error(`Tipo de reporte no disponible: ${tipo}`);
      const periodo = leerPeriodo(datos?.periodo, hoy);
      if (periodo.error) throw new ErrorDeValidacion({ periodo: periodo.error });

      const { desde, hasta } = limitesDelPeriodo(periodo.valor);
      const contenido = consolidarDatos(await baseDeDatos.consultarDatosReporte(desde, hasta), periodo.valor);
      if (contenido.length === 0) {
        throw new ErrorDeValidacion({ periodo: `No hay incapacidades en ${periodo.valor}: no se generó el reporte.` });
      }

      // Doble envío: el mismo reporte del mismo mes, recién generado, ya se guardó y se envió.
      const ultimo = await baseDeDatos.consultarUltimoReporte(tipo, periodo.valor);
      if (ultimo && ahora() - Date.parse(ultimo.creadoEn) < DOBLE_ENVIO_MS && firma(ultimo.contenido) === firma(contenido)) {
        return { idReporte: ultimo.id, periodo: periodo.valor, cantidad: contenido.length };
      }

      const idReporte = await baseDeDatos.guardarReporte(tipo, periodo.valor, contenido, usuario.id);
      await avisarODeshacer({
        operacion: 'reporte de ausentismo',
        asunto: `reporte n.º ${idReporte} de ${periodo.valor}`,
        avisar: () => correo.enviarReporteAusentismo(periodo.valor, contenido),
        deshacer: () => baseDeDatos.eliminarReporte(idReporte),
      });
      return { idReporte, periodo: periodo.valor, cantidad: contenido.length };
    },
  };
}
