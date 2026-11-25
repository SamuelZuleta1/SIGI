// Fábricas de datos de prueba.
export const incapacidadDePrueba = (cambios = {}) => ({
  idIncapacidad: 41,
  colaborador: 'Ana María Gómez',
  correoColaborador: 'ana.gomez@sigi.test',
  tipo: 'enfermedad_general',
  entidad: 'Nueva EPS',
  fechaInicio: '2026-11-03',
  diasIncapacidad: 5,
  ...cambios,
});

// Lo que envía el formulario «Registrar incapacidad» (HU-03): todo llega como texto.
// La recepción, si no se da, es el día siguiente al inicio (HU-03: no puede ser anterior a él).
const diaSiguiente = (fecha) => new Date(Date.parse(`${fecha}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
// Por defecto cumple HU-03/HU-12: lo laboral va a la ARL SURA (1) y una licencia nace el día en que empieza.
const LABORALES = ['accidente_laboral', 'enfermedad_laboral'];
export const formularioDeRegistro = (cambios = {}) => ({
  colaborador: 'Ana María Gómez',
  correoColaborador: 'ana.gomez@sigi.test',
  tipo: 'enfermedad_general',
  entidad: LABORALES.includes(cambios.tipo) ? '1' : '2',
  ...(String(cambios.tipo ?? '').startsWith('licencia_') ? { fechaNacimiento: cambios.fechaInicio ?? '2026-11-03' } : {}),
  fechaInicio: '2026-11-03',
  diasIncapacidad: '5',
  fechaRecepcion: diaSiguiente(/^\d{4}-\d{2}-\d{2}$/.test(cambios.fechaInicio ?? '') ? cambios.fechaInicio : '2026-11-03'),
  ...cambios,
});

// HU-03 (auditoría): el mismo colaborador, tipo, inicio y días es un duplicado. Las pruebas contra la base que
// registran varias veces el mismo caso toman días distintos (5, 6, 7…) de un contador propio.
export const diasDistintos = () => {
  let n = 0;
  return () => String(5 + n++);
};

// Archivos mínimos que pasan la comprobación de contenido (HU-04).
export const PDF = Buffer.from('%PDF-1.4\n% documento de prueba\n');
export const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
export const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]);

export const documentoDePrueba = (cambios = {}) => ({ tipo: 'soporte_incapacidad', contenido: PDF, ...cambios });

// HU-26: una incapacidad pagada de la entidad con su pago registrado (HU-15), en la base de datos falsa. Devuelve el id del pago.
export async function pagoRegistrado(baseDeDatos, { colaborador, entidad = 2, valor, fechaPago = '2026-11-10' }) {
  const correoColaborador = `${colaborador.normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, '.').toLowerCase()}@sigi.test`;
  const id = await baseDeDatos.guardarIncapacidad(
    { colaborador: { nombre: colaborador, correo: correoColaborador }, entidad, tipo: 'enfermedad_general', fechaInicio: '2026-11-01', diasIncapacidad: 10, fechaRecepcion: '2026-11-02' },
    'id-auxiliar',
  );
  baseDeDatos.incapacidades.find((i) => i.idIncapacidad === id).estado = 'cobrada';
  return baseDeDatos.guardarPago(id, { valor, fechaPago }, 'id-auxiliar');
}

// HU-19 (auditoría, decisión 4A): trasladar exige 2 requerimientos y una causal. Registra los dos que falten y traslada.
export async function trasladarConRequerimientos(control, id, { causal = 'deterioro', motivo = '180 días sin pago' } = {}) {
  const { total } = await control.prepararRequerimientos(String(id));
  for (let n = total + 1; n <= 2; n++) {
    await control.registrarRequerimiento(String(id), { fundamentos: `Requerimiento número ${n} de cobro.` }, { id: 'id-auxiliar', rol: 'auxiliar' });
  }
  return control.trasladarACartera(String(id), { causal, motivo });
}
