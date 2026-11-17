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
