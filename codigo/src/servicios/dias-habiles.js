// Días hábiles y fechas del trámite (DA-13): lunes a viernes sin los festivos de Colombia.
// Los festivos van en una lista fija (Ley 51 de 1983: los trasladables pasan al lunes siguiente).
// Fuera de los años de la lista solo se descuentan los fines de semana: hay que ampliarla cada año.
//
// Todas las fechas son texto AAAA-MM-DD (como las columnas `date`) y se calculan en UTC
// para que el huso horario del servidor no corra el día.

export const FESTIVOS = Object.freeze(new Set([
  // 2026 (Pascua: 5 de abril)
  '2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03', '2026-05-01',
  '2026-05-18', '2026-06-08', '2026-06-15', '2026-06-29', '2026-07-20', '2026-08-07',
  '2026-08-17', '2026-10-12', '2026-11-02', '2026-11-16', '2026-12-08', '2026-12-25',
  // 2027 (Pascua: 28 de marzo)
  '2027-01-01', '2027-01-11', '2027-03-22', '2027-03-25', '2027-03-26', '2027-05-01',
  '2027-05-10', '2027-05-31', '2027-06-07', '2027-07-05', '2027-07-20', '2027-08-07',
  '2027-08-16', '2027-10-18', '2027-11-01', '2027-11-15', '2027-12-08', '2027-12-25',
]));

const aFecha = (texto) => new Date(`${texto}T00:00:00Z`);
const aTexto = (fecha) => fecha.toISOString().slice(0, 10);
const siguiente = (texto) => {
  const fecha = aFecha(texto);
  fecha.setUTCDate(fecha.getUTCDate() + 1);
  return aTexto(fecha);
};

/** ¿Es día hábil? (lunes a viernes y no festivo) */
export function esDiaHabil(texto) {
  const dia = aFecha(texto).getUTCDay();
  return dia !== 0 && dia !== 6 && !FESTIVOS.has(texto);
}

/** Fecha que resulta de contar `dias` días hábiles después de `desde` (sin contar `desde`). */
export function sumarDiasHabiles(desde, dias) {
  let fecha = desde;
  for (let contados = 0; contados < dias; ) {
    fecha = siguiente(fecha);
    if (esDiaHabil(fecha)) contados += 1;
  }
  return fecha;
}

/**
 * Días hábiles que quedan desde `hoy` (sin contarlo) hasta `limite` (incluido).
 * 0 = vence hoy; negativo = vencido (cuántos días hábiles han pasado desde el límite).
 */
export function diasHabilesRestantes(hoy, limite) {
  if (hoy === limite) return 0;
  const [desde, hasta, signo] = hoy < limite ? [hoy, limite, 1] : [limite, hoy, -1];
  let cuenta = 0;
  for (let fecha = siguiente(desde); fecha <= hasta; fecha = siguiente(fecha)) {
    if (esDiaHabil(fecha)) cuenta += 1;
  }
  return signo * cuenta;
}

/** Fecha de hoy en Colombia (AAAA-MM-DD), sin importar el huso horario del servidor. */
export const hoyEnColombia = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());

/** Fecha (AAAA-MM-DD) en Colombia de un instante guardado como timestamptz. */
export const fechaEnColombia = (instante) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date(instante));

/** «viernes 20 de noviembre»: para plazos de pocos días, donde el año sobra. */
export const fechaCorta = (texto) =>
  new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' })
    .format(aFecha(texto))
    .replace(',', '');

/** «viernes 20 de noviembre de 2026» */
export const fechaLarga = (texto) =>
  new Intl.DateTimeFormat('es-CO', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .format(aFecha(texto))
    .replace(',', '');

// Plazos en días calendario (HU-09, DA-13): los de transcripción de cada entidad y el de la paternidad.

/**
 * Suma un intervalo { anios, meses, dias } a una fecha, como Postgres: si el día no existe en el mes
 * de llegada se toma el último (31 de enero + 1 mes = 28 o 29 de febrero; 29 de febrero + 1 año = 28).
 */
export function sumarIntervalo(texto, { anios = 0, meses = 0, dias = 0 }) {
  const fecha = aFecha(texto);
  const totalMeses = fecha.getUTCMonth() + anios * 12 + meses;
  const anio = fecha.getUTCFullYear() + Math.floor(totalMeses / 12);
  const mes = ((totalMeses % 12) + 12) % 12;
  const ultimoDia = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  const resultado = new Date(Date.UTC(anio, mes, Math.min(fecha.getUTCDate(), ultimoDia)));
  resultado.setUTCDate(resultado.getUTCDate() + dias);
  return aTexto(resultado);
}

/** Días calendario de `desde` a `hasta` (negativo si `hasta` es anterior). */
export const diasCalendario = (desde, hasta) => Math.round((aFecha(hasta) - aFecha(desde)) / 86_400_000);

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];

/** «9 nov 2026»: para los extremos de un plazo largo, donde el año sí importa. */
export const fechaBreve = (texto) => {
  const fecha = aFecha(texto);
  return `${fecha.getUTCDate()} ${MESES[fecha.getUTCMonth()]} ${fecha.getUTCFullYear()}`;
};
