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
