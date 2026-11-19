// Modelo: Incapacidad (CL-01; tramitePension: DA-10; fechaAvisoFaltantes y fechaNacimiento: DA-13). Clase de datos, sin métodos.
export const TIPOS_INCAPACIDAD = Object.freeze([
  'enfermedad_general',
  'accidente_laboral',
  'enfermedad_laboral',
  'accidente_transito',
  'licencia_maternidad',
  'licencia_paternidad',
]);

export const NOMBRES_TIPO_INCAPACIDAD = Object.freeze({
  enfermedad_general: 'Enfermedad general',
  accidente_laboral: 'Accidente laboral',
  enfermedad_laboral: 'Enfermedad laboral',
  accidente_transito: 'Accidente de tránsito',
  licencia_maternidad: 'Licencia de maternidad',
  licencia_paternidad: 'Licencia de paternidad',
});

// EST-01. El estado inicial («registrada») no tiene valor: null.
export const ESTADOS_INCAPACIDAD = Object.freeze(['transcrita', 'cobrada', 'rechazada', 'pagada']);

// Nombres para mostrar; «registrada» es el estado sin valor (null).
export const NOMBRES_ESTADO_INCAPACIDAD = Object.freeze({
  registrada: 'Registrada',
  transcrita: 'Transcrita',
  cobrada: 'Cobrada',
  rechazada: 'Rechazada',
  pagada: 'Pagada',
});

export const DECISIONES = Object.freeze(['recuperar', 'dar_de_baja']);

export class Incapacidad {
  idIncapacidad;
  tipo;
  fechaInicio;
  diasIncapacidad;
  fechaRecepcion;
  estado = null;
  originalPendiente = false;
  documentacionCompleta = null;
  archivadoDigital = false;
  faltantes = [];
  fechaAvisoFaltantes = null;
  segundoLlamado = false;
  tiempoPago = null;
  causalRechazo = null;
  motivoTraslado = null;
  decision = null;
  concepto = null;
  faltaConcepto = false;
  pagoSuspendido = false;
  ibc = null;
  valorEmpresa = null;
  valorEPS = null;
  tramitePension = false;
  fechaNacimiento = null;
  enviadaAGestionDocumental = false;
}
