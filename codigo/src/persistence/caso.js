// Datos del caso de una incapacidad (DA-50, prórrogas): columnas que agrega la migración de prórrogas y su lectura.
// El trigger de la base las mantiene; aquí solo se leen.
export const COLUMNAS_CASO =
  'prorroga_de, caso_id, dias_previos, dias_acumulados, tiene_prorroga, fecha_dia_90, fecha_dia_120, fecha_dia_150, fecha_dia_180, fecha_dia_181';

/** De la fila (snake_case) a los datos del caso que usan hitos.js y los controles. */
export const aCaso = (f) => ({
  prorrogaDe: f.prorroga_de,
  casoId: f.caso_id,
  diasPrevios: f.dias_previos,
  diasAcumulados: f.dias_acumulados,
  tieneProrroga: f.tiene_prorroga,
  fechasDia: {
    90: f.fecha_dia_90,
    120: f.fecha_dia_120,
    150: f.fecha_dia_150,
    180: f.fecha_dia_180,
    181: f.fecha_dia_181,
  },
});

/** La columna de la fecha del día N del caso, para las escrituras condicionadas (hitos.js, condicionDelDia). */
export const columnaDelDia = (n) => `fecha_dia_${n}`;
