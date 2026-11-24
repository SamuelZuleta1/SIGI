// Grupo `reportes` del Control de incapacidades — DS-12 (CU-16).
// Operación: generarReporte(tipo, periodo) → consultarDatosReporte → consolidarDatos() → guardarReporte(tipo) →
// enviarReporteAusentismo (HU-27, DA-21, DA-57); alternativa A1 (HU-28, DA-19, DA-58): consultarDatosProlongadas →
// consolidarProlongadas() → clasificarPorHito() → guardarReporte(prolongadas), sin correo. Apoyo de la Vista: prepararReportes y consultarReporte.
import { avisarODeshacer } from './error-de-aviso.js';
import { ErrorDeValidacion } from './error-de-validacion.js';
import { DIAS_PROLONGADA, HITOS, diaActual, diasDelCaso, fechaDelDia, llegoAlDia } from './hitos.js';
import { estadoConcepto } from './monitoreo.controller.js';
import { diasCalendario, fechaEnColombia, hoyEnColombia, sumarIntervalo } from '../servicios/dias-habiles.js';
import { TIPOS_REPORTE } from '../models/reporte.model.js';

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
  JSON.stringify(contenido, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v,
  );

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

// HU-28 (DA-58): grupos del reporte de prolongadas, del hito más alto al más bajo. `antes_90` son las que duran más
// de 90 días pero al corte aún no llegan al día 90 (empezaron hace poco o empiezan más adelante en el mes).
export const GRUPOS_HITO = Object.freeze([
  ...[...HITOS].reverse().map((dia) => Object.freeze({ clave: `dia_${dia}`, dia, nombre: `Día ${dia}` })),
  Object.freeze({ clave: 'antes_90', dia: null, nombre: `Aún no llega al día ${HITOS[0]}` }),
]);

/**
 * El corte del reporte de prolongadas: el último día del mes o, si el mes está en curso, el día en que se generó.
 * @param {string} periodo AAAA-MM
 * @param {string} hoy AAAA-MM-DD (para un reporte guardado: el día en Colombia en que se generó)
 */
export function corteDelPeriodo(periodo, hoy) {
  const { hasta } = limitesDelPeriodo(periodo);
  return hasta < hoy ? hasta : hoy;
}

/** El corte de un reporte guardado (se calcula con su fecha de generación; no se guarda aparte). */
export const corteDelReporte = (reporte) => corteDelPeriodo(reporte.periodo, fechaEnColombia(reporte.creadoEn));

/** El hito más alto al que llegó la incapacidad en `corte` (por fecha, DA-49); null si aún no llega al día 90. */
export const hitoAlCorte = (i, corte) => [...HITOS].reverse().find((n) => llegoAlDia(i, n, corte)) ?? null;

/**
 * DS-12: consolidarDatos() del reporte de prolongadas — HU-28, DA-58. Los casos de más de 90 días (DA-47; con prórrogas,
 * días acumulados: DA-50) con al menos un día en el mes; un caso aparece una vez, en su último certificado del mes. De cada una: colaborador, tipo, entidad, fechas, días, estado del concepto (sin su texto) y si
 * el pago está suspendido (al generar) y el estado.
 * @param {{ idIncapacidad, idColaborador, colaborador, tipo, entidad, fechaInicio, diasIncapacidad, estado, concepto, faltaConcepto, pagoSuspendido }[]} incapacidades
 * @param {string} periodo AAAA-MM
 */
export function consolidarProlongadas(incapacidades, periodo) {
  const { desde, hasta } = limitesDelPeriodo(periodo);
  const delMes = incapacidades
    .filter((i) => diasDelCaso(i) > DIAS_PROLONGADA)
    .map((i) => ({ ...i, fechaFin: sumarIntervalo(i.fechaInicio, { dias: i.diasIncapacidad - 1 }) }))
    .filter((i) => i.fechaInicio <= hasta && i.fechaFin >= desde);
  // DA-50: de cada caso, el certificado más avanzado que toca el mes.
  const ultimo = new Map();
  for (const i of delMes) {
    const caso = i.casoId ?? i.idIncapacidad;
    if (!ultimo.has(caso) || (i.diasPrevios ?? 0) > (ultimo.get(caso).diasPrevios ?? 0)) ultimo.set(caso, i);
  }
  return delMes
    .filter((i) => ultimo.get(i.casoId ?? i.idIncapacidad) === i)
    .map((i) => ({
      idIncapacidad: i.idIncapacidad,
      idColaborador: i.idColaborador,
      colaborador: i.colaborador,
      tipo: i.tipo,
      entidad: i.entidad,
      fechaInicio: i.fechaInicio,
      fechaFin: i.fechaFin,
      diasIncapacidad: i.diasIncapacidad,
      // DA-50: los días del caso y las fechas reales de sus hitos (para clasificar sin volver a la base).
      diasPrevios: i.diasPrevios ?? 0,
      diasCaso: diasDelCaso(i),
      ...(i.fechasDia ? { fechasDia: i.fechasDia } : {}),
      estadoConcepto: estadoConcepto(i),
      pagoSuspendido: Boolean(i.pagoSuspendido),
      estado: i.estado ?? 'registrada',
    }));
}

/**
 * DS-12: clasificarPorHito() — HU-28, DA-19, DA-58. A cada prolongada consolidada le agrega el día en que va al corte, el
 * hito más alto alcanzado al corte (por fecha, DA-49) y los hitos cuya fecha cae dentro del mes. Ordenadas del hito
 * más alto al más bajo y, dentro de cada hito, por el día en que van.
 * @param {ReturnType<typeof consolidarProlongadas>} filas
 * @param {string} periodo AAAA-MM
 * @param {string} hoy AAAA-MM-DD
 */
export function clasificarPorHito(filas, periodo, hoy) {
  const { desde, hasta } = limitesDelPeriodo(periodo);
  const corte = corteDelPeriodo(periodo, hoy);
  const orden = (h) => (h == null ? -1 : h);
  return filas
    .map(({ estadoConcepto: concepto, pagoSuspendido, estado, ...f }) => ({
      ...f,
      diaAlCorte: diaActual(f, corte),
      hito: hitoAlCorte(f, corte),
      hitosEnPeriodo: HITOS.filter((n) => diasDelCaso(f) >= n)
        .map((n) => ({ dia: n, fecha: fechaDelDia(f, n) }))
        .filter((h) => h.fecha != null && h.fecha >= desde && h.fecha <= hasta),
      estadoConcepto: concepto,
      pagoSuspendido,
      estado,
    }))
    .sort(
      (a, b) =>
        orden(b.hito) - orden(a.hito) || b.diaAlCorte - a.diaAlCorte || a.fechaInicio.localeCompare(b.fechaInicio) || a.idIncapacidad - b.idIncapacidad,
    );
}

/** Las filas del reporte de prolongadas agrupadas por hito (GRUPOS_HITO), con los grupos vacíos. */
export const porHito = (contenido) =>
  GRUPOS_HITO.map((g) => ({ ...g, filas: contenido.filter((f) => (f.hito ?? null) === g.dia) }));

/**
 * Totales del reporte de prolongadas: incapacidades, colaboradores (por id) y las que tienen algún hito con fecha en el
 * mes (cumplido o, en el mes en curso, próximo).
 */
export const totalesProlongadas = (contenido) => ({
  incapacidades: contenido.length,
  colaboradores: new Set(contenido.map((f) => f.idColaborador ?? f.colaborador)).size,
  conHitoEnMes: contenido.filter((f) => f.hitosEnPeriodo.length > 0).length,
});

export function crearControlReportes({ baseDeDatos, correo, ahora = Date.now }) {
  return {
    /** Apoyo de la Vista: el mes sugerido (el anterior), el mes en curso (máximo) y los reportes recientes. */
    async prepararReportes(hoy = hoyEnColombia()) {
      return {
        periodoSugerido: periodoAnterior(hoy),
        periodoMinimo: PERIODO_MINIMO,
        periodoMaximo: mesDe(hoy),
        recientes: await baseDeDatos.consultarReportes('ausentismo', REPORTES_RECIENTES),
        recientesProlongadas: await baseDeDatos.consultarReportes('prolongadas', REPORTES_RECIENTES),
      };
    },

    /** Apoyo de la Vista: un reporte guardado; null si no existe. */
    async consultarReporte(id) {
      return baseDeDatos.consultarReporte(id);
    },

    /**
     * DS-12: generarReporte(tipo, periodo).
     * - «ausentismo» (HU-27): consulta las incapacidades, consolida las del periodo, guarda el reporte con su contenido
     *   (DA-21; DA-23: quién lo generó) y lo envía al SG-SST. Si el correo falla, borra el reporte y se puede reintentar
     *   (DA-44/DA-47).
     * - «prolongadas» (HU-28, alternativa A1): consulta las prolongadas, las clasifica por hito al corte del mes, guarda
     *   el reporte y lo muestra; no se envía a nadie (DA-58).
     * Un periodo sin datos no se guarda. Un doble envío (mismo mes y contenido en menos de DOBLE_ENVIO_MS) devuelve el
     * reporte ya generado.
     * @param {{ periodo?: string }} datos
     * @param {{ id: string }} usuario
     * @returns {Promise<{ idReporte: number, periodo: string, cantidad: number }>}
     * @throws {ErrorDeValidacion} | {ErrorDeAviso}
     */
    async generarReporte(tipo, datos, usuario, hoy = hoyEnColombia()) {
      if (!TIPOS_REPORTE.includes(tipo)) throw new Error(`Tipo de reporte no disponible: ${tipo}`);
      const periodo = leerPeriodo(datos?.periodo, hoy);
      if (periodo.error) throw new ErrorDeValidacion({ periodo: periodo.error });

      const { desde, hasta } = limitesDelPeriodo(periodo.valor);
      const contenido =
        tipo === 'ausentismo'
          ? consolidarDatos(await baseDeDatos.consultarDatosReporte(desde, hasta), periodo.valor)
          : clasificarPorHito(
              consolidarProlongadas(await baseDeDatos.consultarDatosProlongadas(DIAS_PROLONGADA, desde, hasta), periodo.valor),
              periodo.valor,
              hoy,
            );
      if (contenido.length === 0) {
        const que = tipo === 'ausentismo' ? 'incapacidades' : 'incapacidades prolongadas';
        throw new ErrorDeValidacion({ periodo: `No hay ${que} en ${periodo.valor}: no se generó el reporte.` });
      }

      // Doble envío: el mismo reporte del mismo mes, recién generado, ya se guardó (y, si es de ausentismo, se envió).
      const ultimo = await baseDeDatos.consultarUltimoReporte(tipo, periodo.valor);
      if (ultimo && ahora() - Date.parse(ultimo.creadoEn) < DOBLE_ENVIO_MS && firma(ultimo.contenido) === firma(contenido)) {
        return { idReporte: ultimo.id, periodo: periodo.valor, cantidad: contenido.length };
      }

      const idReporte = await baseDeDatos.guardarReporte(tipo, periodo.valor, contenido, usuario.id);
      if (tipo === 'ausentismo') {
        await avisarODeshacer({
          operacion: 'reporte de ausentismo',
          asunto: `reporte n.º ${idReporte} de ${periodo.valor}`,
          avisar: () => correo.enviarReporteAusentismo(periodo.valor, contenido),
          deshacer: () => baseDeDatos.eliminarReporte(idReporte),
        });
      }
      return { idReporte, periodo: periodo.valor, cantidad: contenido.length };
    },
  };
}
