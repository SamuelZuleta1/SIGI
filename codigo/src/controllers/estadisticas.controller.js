// Grupo `estadisticas` del Control de incapacidades — panel de estadísticas e informes de gestión.
// Operaciones de la Vista (solo el auxiliar, DA-02): consultarEstadisticas(rango, entidad) y generarInforme(tipo, rango,
// entidad, formato). Solo leen: no guardan nada ni envían correos. Los días de ausencia se cuentan con el mismo criterio
// del reporte de ausentismo (HU-27, DA-57): los días de cada certificado que caen dentro del rango.
import { ErrorDeValidacion } from './error-de-validacion.js';
import { DIAS_PROLONGADA } from './hitos.js';
import { PERIODO_MINIMO, limitesDelPeriodo } from './reportes.controller.js';
import { aCentavos, centavosATexto } from '../servicios/moneda.js';
import { diasCalendario, hoyEnColombia, sumarIntervalo } from '../servicios/dias-habiles.js';
import { ESTADOS_INCAPACIDAD, NOMBRES_ESTADO_INCAPACIDAD, NOMBRES_TIPO_INCAPACIDAD } from '../models/incapacidad.model.js';

/** El rango más largo que se puede consultar, en meses. */
export const MAXIMO_MESES = 24;
/** Meses del rango por defecto (el mes en curso y los anteriores). */
export const MESES_POR_DEFECTO = 6;
/** Colaboradores que se listan en «Colaboradores con más días». */
export const TOP_COLABORADORES = 10;

const PERIODO = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const ESTADOS = ['registrada', ...ESTADOS_INCAPACIDAD];
const RESPONDIDAS = ['cobrada', 'pagada', 'rechazada'];

// ---------- formatos ----------
const ENTERO = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
const DECIMAL = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const PORCIENTO = new Intl.NumberFormat('es-CO', { style: 'percent', minimumFractionDigits: 0, maximumFractionDigits: 1 });
const COMPACTO = new Intl.NumberFormat('es-CO', { notation: 'compact', maximumFractionDigits: 1 });

export const numero = (n) => ENTERO.format(n);
export const decimal = (n) => DECIMAL.format(n);
export const porcentaje = (fraccion) => PORCIENTO.format(fraccion).replace(/\s/g, ' ');
/** «$ 1,2 M» para los ejes de las gráficas de dinero. */
export const pesosCortos = (centavos) => `$ ${COMPACTO.format(centavos / 100).replace(/\s/g, ' ')}`;

const mesDe = (fecha) => fecha.slice(0, 7);
/** «nov 2026» */
export const nombreMes = (periodo) => `${MESES[Number(periodo.slice(5, 7)) - 1]} ${periodo.slice(0, 4)}`;
/** «noviembre de 2026» */
export const nombreMesLargo = (periodo) => `${MESES_LARGOS[Number(periodo.slice(5, 7)) - 1]} de ${periodo.slice(0, 4)}`;
/** «jun – nov 2026», «nov 2025 – feb 2026» o «nov 2026». */
export function nombreRango({ desde, hasta }) {
  if (desde === hasta) return nombreMes(desde);
  if (desde.slice(0, 4) === hasta.slice(0, 4)) return `${MESES[Number(desde.slice(5, 7)) - 1]} – ${nombreMes(hasta)}`;
  return `${nombreMes(desde)} – ${nombreMes(hasta)}`;
}

// ---------- rango de meses ----------
const sumarMeses = (periodo, meses) => mesDe(sumarIntervalo(`${periodo}-01`, { meses }));

/** Los meses AAAA-MM de `desde` a `hasta`, ambos incluidos. */
export function mesesDelRango({ desde, hasta }) {
  const meses = [];
  for (let m = desde; m <= hasta; m = sumarMeses(m, 1)) meses.push(m);
  return meses;
}

/** El rango del mismo largo justo antes (para comparar). */
export function rangoAnterior(rango) {
  const largo = mesesDelRango(rango).length;
  return { desde: sumarMeses(rango.desde, -largo), hasta: sumarMeses(rango.desde, -1) };
}

/** Primer día de `desde` y último día de `hasta` (AAAA-MM-DD). */
export const fechasDelRango = ({ desde, hasta }) => ({ desde: limitesDelPeriodo(desde).desde, hasta: limitesDelPeriodo(hasta).hasta });

/** El rango por defecto: el mes en curso y los MESES_POR_DEFECTO - 1 anteriores. */
export const rangoPorDefecto = (hoy) => ({ desde: sumarMeses(mesDe(hoy), -(MESES_POR_DEFECTO - 1)), hasta: mesDe(hoy) });

/** Atajos de rango para el panel y los informes. */
export function atajosDeRango(hoy) {
  const actual = mesDe(hoy);
  const anio = Number(actual.slice(0, 4));
  return [
    { nombre: 'Este mes', desde: actual, hasta: actual },
    { nombre: 'Últimos 3 meses', desde: sumarMeses(actual, -2), hasta: actual },
    { nombre: 'Últimos 6 meses', desde: sumarMeses(actual, -5), hasta: actual },
    { nombre: 'Últimos 12 meses', desde: sumarMeses(actual, -11), hasta: actual },
    { nombre: `Año ${anio}`, desde: `${anio}-01`, hasta: actual },
    { nombre: `Año ${anio - 1}`, desde: `${anio - 1}-01`, hasta: `${anio - 1}-12` },
  ].filter((a) => a.desde >= PERIODO_MINIMO);
}

/**
 * El rango pedido: dos meses AAAA-MM entre PERIODO_MINIMO y el mes en curso, en orden y de hasta MAXIMO_MESES.
 * Sin ninguno de los dos, el rango por defecto.
 * @returns {{ valor?: { desde: string, hasta: string }, errores: Record<string, string>, textos: { desde: string, hasta: string } }}
 */
export function leerRango(consulta, hoy = hoyEnColombia()) {
  const limpio = (v) => (typeof v === 'string' ? v.trim().slice(0, 20) : '');
  const textos = { desde: limpio(consulta?.desde), hasta: limpio(consulta?.hasta) };
  if (!textos.desde && !textos.hasta) {
    const valor = rangoPorDefecto(hoy);
    return { valor, errores: {}, textos: { ...valor } };
  }
  const errores = {};
  const actual = mesDe(hoy);
  for (const campo of ['desde', 'hasta']) {
    const t = textos[campo];
    if (!t) errores[campo] = 'Elija el mes.';
    else if (!PERIODO.test(t)) errores[campo] = 'Escriba el mes como AAAA-MM, por ejemplo 2026-10.';
    else if (t < PERIODO_MINIMO) errores[campo] = `Elija un mes desde ${PERIODO_MINIMO}.`;
    else if (t > actual) errores[campo] = 'El mes no puede ser futuro.';
  }
  if (!errores.desde && !errores.hasta) {
    if (textos.desde > textos.hasta) errores.hasta = 'Debe ser igual o posterior al mes inicial.';
    else if (mesesDelRango(textos).length > MAXIMO_MESES) errores.hasta = `El rango puede tener hasta ${MAXIMO_MESES} meses.`;
  }
  if (Object.keys(errores).length > 0) return { errores, textos };
  return { valor: { desde: textos.desde, hasta: textos.hasta }, errores, textos };
}

/** La entidad pedida (id en texto) entre las disponibles; '' es «todas». */
export function leerEntidad(texto, entidades) {
  const t = typeof texto === 'string' ? texto.trim() : '';
  if (t === '') return { valor: null, texto: '' };
  const entidad = entidades.find((e) => String(e.id) === t);
  return entidad ? { valor: entidad, texto: t } : { error: 'Elija una entidad de la lista.', texto: t.slice(0, 20) };
}

// ---------- cálculos ----------
const finDe = (i) => sumarIntervalo(i.fechaInicio, { dias: i.diasIncapacidad - 1 });

/** Días del certificado que caen dentro de [desde, hasta] (AAAA-MM-DD); 0 si no lo toca. */
export function diasDentro(i, desde, hasta) {
  const fin = i.fechaFin ?? finDe(i);
  const inicio = i.fechaInicio > desde ? i.fechaInicio : desde;
  const final = fin < hasta ? fin : hasta;
  return final < inicio ? 0 : diasCalendario(inicio, final) + 1;
}

/** Las incapacidades con algún día en [desde, hasta], con esos días (`diasEnRango`), por fecha de inicio. */
export function delRango(incapacidades, desde, hasta) {
  return incapacidades
    .map((i) => ({ ...i, fechaFin: i.fechaFin ?? finDe(i) }))
    .map((i) => ({ ...i, diasEnRango: diasDentro(i, desde, hasta) }))
    .filter((i) => i.diasEnRango > 0)
    .sort((a, b) => a.fechaInicio.localeCompare(b.fechaInicio) || a.idIncapacidad - b.idIncapacidad);
}

const pagosEntre = (pagos, desde, hasta) => pagos.filter((p) => p.fechaPago >= desde && p.fechaPago <= hasta);
const sumaCentavos = (pagos) => pagos.reduce((s, p) => s + aCentavos(p.valor), 0);
const fraccion = (parte, total) => (total > 0 ? parte / total : null);

/**
 * Días de la cuenta de cobro al primer pago del rango, promedio por incapacidad; null si ninguna tiene los dos datos.
 */
export function tiempoPromedioDePago(pagos) {
  const primero = new Map();
  for (const p of pagos) {
    const actual = primero.get(p.idIncapacidad);
    if (!actual || p.fechaPago < actual.fechaPago) primero.set(p.idIncapacidad, p);
  }
  const dias = [...primero.values()].filter((p) => p.fechaCobrada).map((p) => Math.max(0, diasCalendario(p.fechaCobrada, p.fechaPago)));
  return dias.length ? Math.round(dias.reduce((s, d) => s + d, 0) / dias.length) : null;
}

/** Los indicadores principales de un rango (AAAA-MM-DD). */
export function indicadores(incapacidades, pagos, desde, hasta) {
  const filas = delRango(incapacidades, desde, hasta);
  const pagados = pagosEntre(pagos, desde, hasta);
  const respondidas = filas.filter((i) => RESPONDIDAS.includes(i.estado)).length;
  const casosProlongados = new Set(filas.filter((i) => (i.diasAcumulados ?? i.diasIncapacidad) > DIAS_PROLONGADA).map((i) => i.casoId ?? i.idIncapacidad));
  return {
    incapacidades: filas.length,
    diasAusencia: filas.reduce((s, i) => s + i.diasEnRango, 0),
    colaboradores: new Set(filas.map((i) => i.idColaborador ?? i.colaborador)).size,
    promedioDias: filas.length ? filas.reduce((s, i) => s + i.diasIncapacidad, 0) / filas.length : null,
    recaudado: sumaCentavos(pagados),
    pagos: pagados.length,
    tiempoPago: tiempoPromedioDePago(pagados),
    respondidas,
    tasaPagadas: fraccion(filas.filter((i) => i.estado === 'pagada').length, respondidas),
    tasaRechazo: fraccion(filas.filter((i) => i.estado === 'rechazada').length, respondidas),
    prolongadas: casosProlongados.size,
  };
}

/** Variación entre dos valores: { fraccion, sube } o null si no hay base. */
export function variacion(actual, anterior) {
  if (actual == null || anterior == null || anterior === 0) return null;
  const f = (actual - anterior) / anterior;
  return { fraccion: Math.abs(f), sube: f > 0, igual: f === 0 };
}

/** Por mes: incapacidades con días en el mes, nuevas (inician en el mes), días de ausencia y recaudo. */
export function serieMensual(incapacidades, pagos, rango) {
  return mesesDelRango(rango).map((mes) => {
    const { desde, hasta } = limitesDelPeriodo(mes);
    const filas = delRango(incapacidades, desde, hasta);
    return {
      mes,
      incapacidades: filas.length,
      nuevas: filas.filter((i) => i.fechaInicio >= desde).length,
      dias: filas.reduce((s, i) => s + i.diasEnRango, 0),
      recaudado: sumaCentavos(pagosEntre(pagos, desde, hasta)),
    };
  });
}

/** Cuántas hay en cada estado (EST-01, con «registrada»). */
export function porEstado(filas) {
  return ESTADOS.map((estado) => ({
    estado,
    nombre: NOMBRES_ESTADO_INCAPACIDAD[estado],
    cantidad: filas.filter((i) => (i.estado ?? 'registrada') === estado).length,
  }));
}

/** Por tipo de incapacidad: cantidad y días en el rango, de más a menos días. */
export function porTipo(filas) {
  const tipos = new Map();
  for (const i of filas) {
    const t = tipos.get(i.tipo) ?? { tipo: i.tipo, nombre: NOMBRES_TIPO_INCAPACIDAD[i.tipo] ?? i.tipo, cantidad: 0, dias: 0 };
    t.cantidad += 1;
    t.dias += i.diasEnRango;
    tipos.set(i.tipo, t);
  }
  return [...tipos.values()].sort((a, b) => b.dias - a.dias || a.nombre.localeCompare(b.nombre));
}

/** Por entidad: incapacidades, días, respuestas, rechazos y lo recaudado en el rango; de más a menos días. */
export function porEntidad(filas, pagos) {
  const entidades = new Map();
  const de = (id, nombre) => {
    if (!entidades.has(id)) entidades.set(id, { idEntidad: id, entidad: nombre, incapacidades: 0, dias: 0, respondidas: 0, rechazadas: 0, recaudado: 0, pagos: 0 });
    return entidades.get(id);
  };
  for (const i of filas) {
    const e = de(i.idEntidad, i.entidad);
    e.incapacidades += 1;
    e.dias += i.diasEnRango;
    if (RESPONDIDAS.includes(i.estado)) e.respondidas += 1;
    if (i.estado === 'rechazada') e.rechazadas += 1;
  }
  for (const p of pagos) {
    const e = de(p.idEntidad, p.entidad);
    e.recaudado += aCentavos(p.valor);
    e.pagos += 1;
  }
  return [...entidades.values()]
    .map((e) => ({ ...e, tasaRechazo: fraccion(e.rechazadas, e.respondidas) }))
    .sort((a, b) => b.dias - a.dias || b.recaudado - a.recaudado || a.entidad.localeCompare(b.entidad));
}

/** Los colaboradores con más días de ausencia en el rango. */
export function topColaboradores(filas, limite = TOP_COLABORADORES) {
  const personas = new Map();
  for (const i of filas) {
    const clave = i.idColaborador ?? i.colaborador;
    const c = personas.get(clave) ?? { colaborador: i.colaborador, incapacidades: 0, dias: 0 };
    c.incapacidades += 1;
    c.dias += i.diasEnRango;
    personas.set(clave, c);
  }
  return [...personas.values()].sort((a, b) => b.dias - a.dias || b.incapacidades - a.incapacidades || a.colaborador.localeCompare(b.colaborador)).slice(0, limite);
}

// Antigüedad de la cartera: días desde la cuenta de cobro (HU-13) hasta hoy.
export const TRAMOS_CARTERA = Object.freeze([
  Object.freeze({ clave: '0-30', nombre: '0 a 30 días', hasta: 30 }),
  Object.freeze({ clave: '31-60', nombre: '31 a 60 días', hasta: 60 }),
  Object.freeze({ clave: '61-90', nombre: '61 a 90 días', hasta: 90 }),
  Object.freeze({ clave: '91-180', nombre: '91 a 180 días', hasta: 180 }),
  Object.freeze({ clave: 'mas-180', nombre: 'Más de 180 días', hasta: Infinity }),
]);

/**
 * La cartera pendiente hoy: las cobradas que no se dieron de baja (como el seguimiento, HU-16), con los días desde la
 * cuenta de cobro, la fecha prometida de pago (DA-38) y si ya se venció.
 */
export function carteraPendiente(cobradas, hoy) {
  const filas = cobradas
    .map((c) => {
      const plazo = c.tiempoPago == null || c.tiempoPago === '' ? null : Number(c.tiempoPago);
      const vence = c.fechaCobrada && Number.isFinite(plazo) ? sumarIntervalo(c.fechaCobrada, { dias: plazo }) : null;
      return {
        ...c,
        diasTranscurridos: c.fechaCobrada ? Math.max(0, diasCalendario(c.fechaCobrada, hoy)) : null,
        plazo: Number.isFinite(plazo) ? plazo : null,
        vence,
        vencida: vence != null && vence < hoy,
      };
    })
    .sort((a, b) => (b.diasTranscurridos ?? -1) - (a.diasTranscurridos ?? -1) || a.idIncapacidad - b.idIncapacidad);
  const tramos = TRAMOS_CARTERA.map((t, k) => {
    const desde = k === 0 ? 0 : TRAMOS_CARTERA[k - 1].hasta + 1;
    return { ...t, cantidad: filas.filter((f) => f.diasTranscurridos != null && f.diasTranscurridos >= desde && f.diasTranscurridos <= t.hasta).length };
  });
  const sinFecha = filas.filter((f) => f.diasTranscurridos == null).length;
  return { filas, tramos, sinFecha, total: filas.length, vencidas: filas.filter((f) => f.vencida).length };
}

/**
 * Todo lo del panel para un rango (AAAA-MM) y, si se eligió, una entidad.
 * @param {{ incapacidades: object[], pagos: object[], cobradas: object[] }} datos
 */
export function calcularEstadisticas({ incapacidades, pagos, cobradas }, rango, { entidad = null, hoy = hoyEnColombia() } = {}) {
  const propias = entidad ? incapacidades.filter((i) => i.idEntidad === entidad.id) : incapacidades;
  const pagosPropios = entidad ? pagos.filter((p) => p.idEntidad === entidad.id) : pagos;
  const cobradasPropias = entidad ? cobradas.filter((c) => c.idEntidad === entidad.id) : cobradas;

  const { desde, hasta } = fechasDelRango(rango);
  const anterior = rangoAnterior(rango);
  const fechasAnterior = fechasDelRango(anterior);
  const actual = indicadores(propias, pagosPropios, desde, hasta);
  const previo = indicadores(propias, pagosPropios, fechasAnterior.desde, fechasAnterior.hasta);
  const filas = delRango(propias, desde, hasta);
  const pagosDelRango = pagosEntre(pagosPropios, desde, hasta);

  return {
    rango,
    fechas: { desde, hasta },
    anterior,
    indicadores: actual,
    previo,
    variaciones: {
      incapacidades: variacion(actual.incapacidades, previo.incapacidades),
      diasAusencia: variacion(actual.diasAusencia, previo.diasAusencia),
      recaudado: variacion(actual.recaudado, previo.recaudado),
    },
    serie: serieMensual(propias, pagosPropios, rango),
    estados: porEstado(filas),
    tipos: porTipo(filas),
    entidades: porEntidad(filas, pagosDelRango),
    colaboradores: topColaboradores(filas),
    cartera: carteraPendiente(cobradasPropias, hoy),
    filas,
    pagos: [...pagosDelRango].sort((a, b) => a.fechaPago.localeCompare(b.fechaPago) || a.idPago - b.idPago),
  };
}

// ---------- informes ----------
export const TIPOS_INFORME = Object.freeze([
  Object.freeze({
    clave: 'gestion',
    nombre: 'Informe de gestión',
    descripcion: 'Indicadores del periodo, comparación con el periodo anterior, evolución mensual, estados, tipos, entidades y cartera.',
    usaRango: true,
  }),
  Object.freeze({
    clave: 'detalle',
    nombre: 'Detalle de incapacidades',
    descripcion: 'Cada incapacidad con días en el periodo: colaborador, tipo, entidad, fechas, días y estado.',
    usaRango: true,
  }),
  Object.freeze({
    clave: 'recaudo',
    nombre: 'Recaudo por entidad',
    descripcion: 'Los pagos registrados en el periodo, totalizados por entidad y con los días desde la cuenta de cobro.',
    usaRango: true,
  }),
  Object.freeze({
    clave: 'cartera',
    nombre: 'Cartera pendiente',
    descripcion: 'Las incapacidades cobradas que siguen sin pago hoy, por antigüedad y con su fecha prometida.',
    usaRango: false,
  }),
]);
export const FORMATOS_INFORME = Object.freeze(['html', 'csv']);

/** Una celda de CSV: entre comillas si hace falta y sin fórmulas (un texto que empieza con = + - @ se antepone con '). */
export function celdaCsv(valor) {
  if (valor == null) return '';
  if (typeof valor === 'number') return String(valor).replace('.', ',');
  let texto = String(valor);
  if (/^[=+\-@\t\r]/.test(texto) && !/^-\d+([.,]\d+)?$/.test(texto)) texto = `'${texto}`;
  return /[";\r\n]/.test(texto) || texto !== texto.trim() ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/** CSV para Excel en español: BOM UTF-8, separado por punto y coma, fin de línea CRLF. */
export const aCsv = (filas) => `\uFEFF${filas.map((f) => f.map(celdaCsv).join(';')).join('\r\n')}\r\n`;

const dinero = (centavos) => centavosATexto(centavos).replace('.', ',');
const tasaCsv = (f) => (f == null ? '' : Math.round(f * 1000) / 10);
const nombreEstado = (e) => NOMBRES_ESTADO_INCAPACIDAD[e ?? 'registrada'] ?? e;
const nombreTipo = (t) => NOMBRES_TIPO_INCAPACIDAD[t] ?? t;

/** Las filas del CSV de un informe ya calculado. */
export function filasCsv(informe) {
  const { tipo, estadisticas: e, encabezado } = informe;
  const cabecera = [
    ['SIGI', informe.titulo],
    ...(tipo.usaRango ? [['Periodo', `${encabezado.desde} a ${encabezado.hasta}`]] : [['Corte', encabezado.corte]]),
    ['Entidad', encabezado.entidad],
    ['Generado', encabezado.generado],
    [],
  ];
  if (tipo.clave === 'detalle') {
    return [
      ...cabecera,
      ['Incapacidad', 'Colaborador', 'Tipo', 'Entidad', 'Inicio', 'Fin', 'Días del certificado', 'Días en el periodo', 'Estado', 'Recepción', 'Cuenta de cobro'],
      ...e.filas.map((i) => [i.idIncapacidad, i.colaborador, nombreTipo(i.tipo), i.entidad, i.fechaInicio, i.fechaFin, i.diasIncapacidad, i.diasEnRango, nombreEstado(i.estado), i.fechaRecepcion ?? '', i.fechaCobrada ?? '']),
      [],
      ['Total', '', '', '', '', '', '', e.indicadores.diasAusencia],
    ];
  }
  if (tipo.clave === 'recaudo') {
    return [
      ...cabecera,
      ['Entidad', 'Pagos', 'Valor recaudado (COP)'],
      ...e.entidades.filter((x) => x.pagos > 0).map((x) => [x.entidad, x.pagos, dinero(x.recaudado)]),
      ['Total', e.indicadores.pagos, dinero(e.indicadores.recaudado)],
      [],
      ['Fecha de pago', 'Incapacidad', 'Colaborador', 'Entidad', 'Valor (COP)', 'Cuenta de cobro', 'Días desde el cobro'],
      ...e.pagos.map((p) => [p.fechaPago, p.idIncapacidad, p.colaborador, p.entidad, dinero(aCentavos(p.valor)), p.fechaCobrada ?? '', p.fechaCobrada ? Math.max(0, diasCalendario(p.fechaCobrada, p.fechaPago)) : '']),
    ];
  }
  if (tipo.clave === 'cartera') {
    const c = e.cartera;
    return [
      ...cabecera,
      ['Antigüedad', 'Incapacidades'],
      ...c.tramos.map((t) => [t.nombre, t.cantidad]),
      ...(c.sinFecha ? [['Sin fecha de cobro', c.sinFecha]] : []),
      ['Total', c.total],
      ['Vencidas', c.vencidas],
      [],
      ['Incapacidad', 'Colaborador', 'Tipo', 'Entidad', 'Cuenta de cobro', 'Días transcurridos', 'Plazo prometido (días)', 'Vence', 'Situación', 'Requerimientos'],
      ...c.filas.map((f) => [f.idIncapacidad, f.colaborador, nombreTipo(f.tipo), f.entidad, f.fechaCobrada ?? '', f.diasTranscurridos ?? '', f.plazo ?? '', f.vence ?? '', f.vencida ? 'Vencida' : 'En plazo', f.requerimientos ?? 0]),
    ];
  }
  // gestion
  const ind = e.indicadores;
  const prev = e.previo;
  return [
    ...cabecera,
    ['Indicador', 'Periodo', 'Periodo anterior'],
    ['Incapacidades con días en el periodo', ind.incapacidades, prev.incapacidades],
    ['Días de ausencia', ind.diasAusencia, prev.diasAusencia],
    ['Colaboradores', ind.colaboradores, prev.colaboradores],
    ['Promedio de días por incapacidad', ind.promedioDias == null ? '' : Math.round(ind.promedioDias * 10) / 10, prev.promedioDias == null ? '' : Math.round(prev.promedioDias * 10) / 10],
    ['Valor recaudado (COP)', dinero(ind.recaudado), dinero(prev.recaudado)],
    ['Pagos registrados', ind.pagos, prev.pagos],
    ['Días promedio del cobro al pago', ind.tiempoPago ?? '', prev.tiempoPago ?? ''],
    ['Pagadas sobre respondidas (%)', tasaCsv(ind.tasaPagadas), tasaCsv(prev.tasaPagadas)],
    ['Rechazadas sobre respondidas (%)', tasaCsv(ind.tasaRechazo), tasaCsv(prev.tasaRechazo)],
    ['Casos prolongados (más de 90 días)', ind.prolongadas, prev.prolongadas],
    [],
    ['Mes', 'Incapacidades', 'Nuevas', 'Días de ausencia', 'Recaudado (COP)'],
    ...e.serie.map((m) => [m.mes, m.incapacidades, m.nuevas, m.dias, dinero(m.recaudado)]),
    [],
    ['Estado', 'Incapacidades'],
    ...e.estados.map((s) => [s.nombre, s.cantidad]),
    [],
    ['Tipo', 'Incapacidades', 'Días en el periodo'],
    ...e.tipos.map((t) => [t.nombre, t.cantidad, t.dias]),
    [],
    ['Entidad', 'Incapacidades', 'Días en el periodo', 'Respondidas', 'Rechazadas', 'Rechazo (%)', 'Recaudado (COP)'],
    ...e.entidades.map((x) => [x.entidad, x.incapacidades, x.dias, x.respondidas, x.rechazadas, tasaCsv(x.tasaRechazo), dinero(x.recaudado)]),
    [],
    ['Cartera pendiente hoy', e.cartera.total],
    ['Vencidas', e.cartera.vencidas],
    ...e.cartera.tramos.map((t) => [t.nombre, t.cantidad]),
  ];
}

/** Nombre del archivo CSV: sigi-<tipo>-<desde>_<hasta>.csv (o con la fecha de corte). */
export function nombreArchivo(informe) {
  const { tipo, estadisticas } = informe;
  const sufijo = tipo.usaRango ? `${estadisticas.rango.desde}_${estadisticas.rango.hasta}` : informe.hoy;
  return `sigi-${tipo.clave}-${sufijo}.csv`;
}

export function crearControlEstadisticas({ baseDeDatos }) {
  /** Lee lo necesario para el rango y su rango anterior (para comparar). */
  const leerDatos = async (rango, soloCartera = false) => {
    if (soloCartera) return { incapacidades: [], pagos: [], cobradas: await baseDeDatos.consultarCobradas() };
    const desde = fechasDelRango(rangoAnterior(rango)).desde;
    const { hasta } = fechasDelRango(rango);
    const [incapacidades, pagos, cobradas] = await Promise.all([
      baseDeDatos.consultarDatosEstadisticas(desde, hasta),
      baseDeDatos.consultarPagosDelPeriodo(desde, hasta),
      baseDeDatos.consultarCobradas(),
    ]);
    return { incapacidades, pagos, cobradas };
  };

  /** Rango y entidad de la consulta, con sus errores. */
  const leerFiltros = (consulta, entidades, hoy) => {
    const rango = leerRango(consulta, hoy);
    const entidad = leerEntidad(consulta?.entidad, entidades);
    const errores = { ...rango.errores, ...(entidad.error ? { entidad: entidad.error } : {}) };
    return { rango: rango.valor, entidad: entidad.valor ?? null, errores, textos: { ...rango.textos, entidad: entidad.texto } };
  };

  return {
    /**
     * consultarEstadisticas(rango, entidad): el panel. Con filtros no válidos devuelve los errores y sin estadísticas.
     * @returns {Promise<{ filtros, errores, entidades, atajos, estadisticas: object|null, entidad: object|null }>}
     */
    async consultarEstadisticas(consulta, hoy = hoyEnColombia()) {
      const entidades = await baseDeDatos.consultarEntidades();
      const { rango, entidad, errores, textos } = leerFiltros(consulta, entidades, hoy);
      const base = { filtros: textos, errores, entidades, atajos: atajosDeRango(hoy), entidad, hoy, periodoMaximo: mesDe(hoy), periodoMinimo: PERIODO_MINIMO };
      if (Object.keys(errores).length > 0) return { ...base, estadisticas: null };
      return { ...base, estadisticas: calcularEstadisticas(await leerDatos(rango), rango, { entidad, hoy }) };
    },

    /** Apoyo de la Vista: el formulario de informes con los filtros que traiga la consulta (o los de por defecto). */
    async prepararInformes(consulta = {}, hoy = hoyEnColombia()) {
      const entidades = await baseDeDatos.consultarEntidades();
      const { textos } = leerFiltros(consulta, entidades, hoy);
      const tipo = TIPOS_INFORME.some((t) => t.clave === consulta?.tipo) ? consulta.tipo : 'gestion';
      return { filtros: { ...textos, tipo, formato: consulta?.formato === 'csv' ? 'csv' : 'html' }, entidades, atajos: atajosDeRango(hoy), tipos: TIPOS_INFORME, periodoMaximo: mesDe(hoy), periodoMinimo: PERIODO_MINIMO };
    },

    /**
     * generarInforme(tipo, rango, entidad, formato). No guarda nada: se calcula al pedirlo.
     * @param {{ id: string, correo: string }} usuario
     * @throws {ErrorDeValidacion}
     */
    async generarInforme(consulta, usuario, hoy = hoyEnColombia(), ahora = new Date()) {
      const entidades = await baseDeDatos.consultarEntidades();
      const tipo = TIPOS_INFORME.find((t) => t.clave === consulta?.tipo);
      const formato = FORMATOS_INFORME.includes(consulta?.formato) ? consulta.formato : 'html';
      // La cartera es una foto de hoy: no usa rango (se toma el por defecto solo para leer los datos).
      const { rango, entidad, errores } = leerFiltros(tipo?.usaRango === false ? { entidad: consulta?.entidad } : consulta, entidades, hoy);
      if (!tipo) errores.tipo = 'Elija el informe que quiere generar.';
      if (Object.keys(errores).length > 0) throw new ErrorDeValidacion(errores);

      const estadisticas = calcularEstadisticas(await leerDatos(rango, tipo.clave === 'cartera'), rango, { entidad, hoy });
      const generado = new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', dateStyle: 'long', timeStyle: 'short' }).format(ahora);
      return {
        tipo,
        formato,
        titulo: tipo.nombre,
        hoy,
        estadisticas,
        entidad,
        encabezado: {
          desde: rango.desde,
          hasta: rango.hasta,
          corte: hoy,
          entidad: entidad?.nombre ?? 'Todas',
          generado: `${generado} · ${usuario.correo ?? ''}`.trim(),
        },
      };
    },
  };
}

