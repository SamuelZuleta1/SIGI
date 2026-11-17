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
