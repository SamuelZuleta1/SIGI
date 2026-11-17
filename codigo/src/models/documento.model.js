// Modelo: Documento (CL-01; tipos: DA-06). Clase de datos, sin métodos.
export const TIPOS_DOCUMENTO = Object.freeze([
  'soporte_incapacidad',
  'epicrisis',
  'historia_clinica',
  'furips',
  'certificado_nacido_vivo',
  'registro_civil',
  'documento_identidad',
]);

export const NOMBRES_TIPO_DOCUMENTO = Object.freeze({
  soporte_incapacidad: 'Soporte de la incapacidad',
  epicrisis: 'Epicrisis o documento soporte',
  historia_clinica: 'Historia clínica',
  furips: 'FURIPS',
  certificado_nacido_vivo: 'Certificado de nacido vivo',
  registro_civil: 'Registro civil',
  documento_identidad: 'Documento de identidad',
});

// Solo el auxiliar puede verlos (HU-02, CAR-11).
export const TIPOS_DOCUMENTO_RESERVADOS = Object.freeze(['epicrisis', 'historia_clinica']);

export class Documento {
  tipo;
  archivo;
}
