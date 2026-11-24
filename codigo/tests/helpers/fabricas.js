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
export const formularioDeRegistro = (cambios = {}) => ({
  colaborador: 'Ana María Gómez',
  correoColaborador: 'ana.gomez@sigi.test',
  tipo: 'enfermedad_general',
  entidad: '2',
  fechaInicio: '2026-11-03',
  diasIncapacidad: '5',
  fechaRecepcion: '2026-11-04',
  ...cambios,
});

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

