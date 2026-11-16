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

// Solo el auxiliar puede verlos (HU-02, CAR-11).
export const TIPOS_DOCUMENTO_RESERVADOS = Object.freeze(['epicrisis', 'historia_clinica']);

export class Documento {
  tipo;
  archivo;
}
