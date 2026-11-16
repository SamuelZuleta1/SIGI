// Conversión entre los nombres del diseño (camelCase) y las columnas de Postgres (snake_case) — P-E.
// La usan los 14 archivos de persistencia.

// valorEPS → valor_eps; diasIncapacidad → dias_incapacidad
export const aSnake = (nombre) =>
  nombre
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();

const SIGLAS = { eps: 'EPS' };

// valor_eps → valorEPS; dias_incapacidad → diasIncapacidad
export const aCamel = (nombre) =>
  nombre
    .split('_')
    .map((parte, i) => (i === 0 ? parte : SIGLAS[parte] ?? parte[0].toUpperCase() + parte.slice(1)))
    .join('');

const convertirClaves = (objeto, convertir, renombres) =>
  Object.fromEntries(
    Object.entries(objeto)
      .filter(([, valor]) => valor !== undefined)
      .map(([clave, valor]) => [renombres[clave] ?? convertir(clave), valor]),
  );

/** Objeto del modelo → fila de la tabla. `renombres`: { idIncapacidad: 'id' }. */
export const aFila = (objeto, renombres = {}) => convertirClaves(objeto, aSnake, renombres);

/** Fila de la tabla → objeto del modelo. `renombres`: { id: 'idIncapacidad' }. */
export const desdeFila = (fila, renombres = {}) =>
  fila == null ? null : convertirClaves(fila, aCamel, renombres);
