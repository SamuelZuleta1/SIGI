// Grupo `alertas` del Control de incapacidades — DS-14 (CU-09).
// Operación: obtenerAlertas → consultarPlazos → calcularVencimientos() → listaAlertas(porVencer, vencidas) (HU-12).
// Solo informa: no modifica ningún dato ni bloquea ninguna operación (HU-12.CA2, CAR-03).
import { diasCalendario, diasHabilesRestantes, hoyEnColombia, sumarDiasHabiles, sumarIntervalo } from '../servicios/dias-habiles.js';
import { HITOS, diasDelCaso, fechaDelDia } from './hitos.js';
import { DIAS_POR_VENCER, calcularPlazoRadicacion, puedeRadicar } from './radicacion.controller.js';
import { DIAS_PARA_ENTREGAR } from './verificacion.controller.js';

// Envío de la incapacidad: 2 días calendario de `fechaInicio` a `fechaRecepcion` (DA-13).
export const DIAS_PARA_ENVIAR = 2;

// Hitos de las incapacidades prolongadas (CAR-07): la regla vive en hitos.js, compartida con el monitoreo (DA-49).
export { HITOS };

// Los 8 tipos de plazo de HU-12, en el orden en que los enumera la historia.
export const TIPOS_PLAZO = Object.freeze(['envio', 'subsanacion', 'transcripcion', 'paternidad', ...HITOS.map((n) => `hito${n}`)]);

export const NOMBRES_PLAZO = Object.freeze({
  envio: 'Envío de la incapacidad',
  subsanacion: 'Subsanación de documentos',
  transcripcion: 'Transcripción',
  paternidad: 'Licencia de paternidad',
  ...Object.fromEntries(HITOS.map((n) => [`hito${n}`, `Hito de ${n} días`])),
});

/** «Por vencer» = de hoy hasta 5 días calendario antes del límite; «vencido» = desde el día siguiente (DA-13, DA-35). */
const estadoDelPlazo = (hoy, fechaLimite) => {
  const dias = diasCalendario(hoy, fechaLimite);
  return dias < 0 ? 'vencido' : dias <= DIAS_POR_VENCER ? 'por_vencer' : null;
};

const alerta = (incapacidad, tipo, estado, fechaLimite, hoy, extra = {}) => ({
  tipo,
  estado,
  idIncapacidad: incapacidad.idIncapacidad,
  colaborador: incapacidad.colaborador,
  entidad: incapacidad.entidad.nombre,
  fechaLimite,
  // Días calendario: positivos = faltan; negativos = pasaron desde el límite.
  dias: diasCalendario(hoy, fechaLimite),
  ...extra,
});

/**
 * Envío (DA-37): solo puede llegar tarde, porque ya se recibió; se muestra mientras siga sin radicar.
 * Auditoría (HU-03): una recepción posterior a hoy no es una llegada tarde (el registro ya no la admite; si quedara
 * algún dato así de antes, no se alerta).
 */
function alertaEnvio(i, hoy) {
  if (i.estado != null || i.fechaRecepcion > hoy) return null;
  const fechaLimite = sumarIntervalo(i.fechaInicio, { dias: DIAS_PARA_ENVIAR });
  if (i.fechaRecepcion <= fechaLimite) return null;
  return alerta(i, 'envio', 'vencido', fechaLimite, hoy, {
    fechaRecepcion: i.fechaRecepcion,
    diasTarde: diasCalendario(fechaLimite, i.fechaRecepcion),
  });
}

/** Subsanación (DA-13, DA-37): 3 días hábiles desde el aviso, mientras esté pendiente y sin segundo llamado. */
function alertaSubsanacion(i, hoy) {
  if (i.documentacionCompleta !== false || !i.fechaAvisoFaltantes || i.segundoLlamado) return null;
  const fechaLimite = sumarDiasHabiles(i.fechaAvisoFaltantes, DIAS_PARA_ENTREGAR);
  const estado = estadoDelPlazo(hoy, fechaLimite);
  if (!estado) return null;
  return alerta(i, 'subsanacion', estado, fechaLimite, hoy, {
    fechaAviso: i.fechaAvisoFaltantes,
    diasHabiles: diasHabilesRestantes(hoy, fechaLimite),
  });
}

/** Transcripción y paternidad (DA-13, DA-35, DA-37): el plazo de radicación, hasta que se radique. */
function alertaTranscripcion(i, hoy) {
  if (!puedeRadicar(i.estado, i.motivoTraslado)) return null; // una trasladada ya no se radica (DA-70)
  const plazo = calcularPlazoRadicacion(i, i.entidad, hoy);
  if (!plazo || plazo.estado === 'al_dia') return null;
  return alerta(i, plazo.regla === 'paternidad' ? 'paternidad' : 'transcripcion', plazo.estado, plazo.fechaLimite, hoy, {
    base: plazo.base,
    duracion: plazo.duracion,
    rechazada: i.estado === 'rechazada',
  });
}

/**
 * Hitos 90/120/150/180 (DA-37): el hito N aplica si el caso dura N días o más y se cumple el día N del caso
 * (DA-50: con sus prórrogas, en la fecha real de ese día). Solo en el certificado vigente del caso, mientras está
 * vigente, y un solo hito por caso: el próximo si se cumple en 5 días o menos; si no, el último que ya se cumplió.
 */
function alertaHito(i, hoy) {
  if (i.tieneProrroga) return null;
  const fechaFin = sumarIntervalo(i.fechaInicio, { dias: i.diasIncapacidad - 1 });
  if (hoy > fechaFin) return null;
  const hitos = HITOS.filter((n) => diasDelCaso(i) >= n && fechaDelDia(i, n) != null).map((n) => ({ n, fecha: fechaDelDia(i, n) }));
  const proximo = hitos.find((h) => h.fecha >= hoy);
  const elegido = proximo && estadoDelPlazo(hoy, proximo.fecha) ? proximo : hitos.findLast((h) => h.fecha < hoy);
  if (!elegido) return null;
  return alerta(i, `hito${elegido.n}`, estadoDelPlazo(hoy, elegido.fecha), elegido.fecha, hoy, {
    fechaInicio: i.fechaInicio,
    diasIncapacidad: diasDelCaso(i),
  });
}

const porFecha = (a, b) => a.fechaLimite.localeCompare(b.fechaLimite) || a.idIncapacidad - b.idIncapacidad || TIPOS_PLAZO.indexOf(a.tipo) - TIPOS_PLAZO.indexOf(b.tipo);

/**
 * DS-14: calcularVencimientos(). Todas las alertas por vencer y vencidas de las incapacidades dadas.
 * @param {object[]} incapacidades las de `consultarPlazos`, con su entidad y sus plazos.
 * @param {string} hoy AAAA-MM-DD
 * @returns {object[]} alertas ordenadas por fecha límite.
 */
export function calcularVencimientos(incapacidades, hoy) {
  return incapacidades
    .flatMap((i) => [alertaEnvio(i, hoy), alertaSubsanacion(i, hoy), alertaTranscripcion(i, hoy), alertaHito(i, hoy)])
    .filter(Boolean)
    .sort(porFecha);
}

/** Lee el filtro de tipo de la URL; un valor desconocido equivale a «todos». */
export function leerTipo(consulta = {}) {
  const valor = Array.isArray(consulta.tipo) ? consulta.tipo[0] : consulta.tipo;
  return TIPOS_PLAZO.includes(valor) ? valor : '';
}

export function crearControlAlertas({ baseDeDatos, hoy = hoyEnColombia }) {
  return {
    /**
     * DS-14: obtenerAlertas → consultarPlazos → calcularVencimientos() → listaAlertas(porVencer, vencidas) — HU-12.CA1.
     * Filtro opcional por tipo de plazo; los conteos por tipo cuentan todas las alertas.
     * Solo consulta (HU-12.CA2).
     */
    async obtenerAlertas(consulta) {
      const tipo = leerTipo(consulta);
      const fechaHoy = hoy();
      const todas = calcularVencimientos(await baseDeDatos.consultarPlazos(), fechaHoy);
      const conteos = Object.fromEntries(TIPOS_PLAZO.map((t) => [t, todas.filter((a) => a.tipo === t).length]));
      const visibles = tipo ? todas.filter((a) => a.tipo === tipo) : todas;
      return {
        hoy: fechaHoy,
        tipo,
        total: todas.length,
        conteos,
        vencidas: visibles.filter((a) => a.estado === 'vencido'),
        porVencer: visibles.filter((a) => a.estado === 'por_vencer'),
      };
    },
  };
}
