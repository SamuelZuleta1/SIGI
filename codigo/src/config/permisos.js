// Permisos por rol (DA-02): cada operación de la Vista solo la ejecuta el actor
// que la envía en su diagrama de secuencia. Fuente: docs/auditoria/03_decisiones.md,
// tabla «Permisos por rol».
import { TIPOS_DOCUMENTO_RESERVADOS } from '../models/documento.model.js';

const AUXILIAR = [
  'registrarIncapacidad', 'registrarDocumentos',                                              // DS-01 (canal correo)
  'verificarDocumentacion', 'confirmarVerificacion', 'notificarFaltantes',
  'registrarSegundoLlamado', 'verDocumento',                                                  // DS-03, DA-06
  'prepararRadicacion', 'registrarRadicacion',                                                // DS-04
  'consultarEstados',                                                                         // DS-05
  'registrarCobrada', 'registrarRechazo', 'registrarPago', 'anularPago',                      // DS-06 (+ auditoría)
  'consultarPendientesDePago', 'registrarSeguimiento', 'registrarAcuerdo',                    // DS-07
  'registrarRequerimiento', 'trasladarACartera',                                              // DS-08
  'calcularReconocimiento',                                                                   // DS-09
  'consultarReporteProlongadas', 'registrarConcepto', 'registrarFaltaConcepto',
  'registrarSuspensionPago',                                                                  // DS-10
  'identificarPagos',                                                                         // DS-11
  'generarReporte',                                                                           // DS-12
  'consultarPagadas', 'archivarIncapacidad', 'registrarEnvioArchivo',                         // DS-13
  'consultarAlertas',                                                                         // DS-14
  'consultarEstadisticas', 'generarInforme',                                                  // estadísticas e informes
];

export const OPERACIONES_POR_ROL = Object.freeze({
  receptor: Object.freeze(['registrarIncapacidad', 'registrarDocumentos']),                   // DS-01
  lider: Object.freeze(['registrarReemplazo']),                                               // DS-02
  auxiliar: Object.freeze(AUXILIAR),
  contabilidad: Object.freeze(['registrarPagosConsignados', 'anularPagoConsignado']),         // DS-11 (+ auditoría)
  cartera: Object.freeze(['registrarDecision']),                                              // DS-08
});

export const OPERACIONES = Object.freeze([...new Set(Object.values(OPERACIONES_POR_ROL).flat())]);

export const NOMBRES_DE_ROL = Object.freeze({
  receptor: 'Personal receptor',
  lider: 'Líder / Jefe inmediato',
  auxiliar: 'Auxiliar de Administración de Personal',
  contabilidad: 'Contabilidad y Tesorería',
  cartera: 'Cartera y Jurídica',
});

/** Pantalla a la que entra cada rol al iniciar sesión (no hay página de inicio aparte). */
export const PAGINA_DE_ENTRADA = Object.freeze({
  receptor: '/incapacidades/nueva',
  lider: '/reemplazo',
  auxiliar: '/incapacidades/nueva',
  contabilidad: '/pagos-consignados',
  cartera: '/cartera',
});

/** ¿Puede este rol ejecutar esta operación de la Vista? */
export function puedeEjecutar(rol, operacion) {
  if (!OPERACIONES.includes(operacion)) throw new Error(`Operación desconocida: ${operacion}`);
  return OPERACIONES_POR_ROL[rol]?.includes(operacion) ?? false;
}

/** HU-02 / CAR-11: la historia clínica y la epicrisis solo las ve el auxiliar. */
export function puedeVerDocumento(rol, tipoDocumento) {
  if (!puedeEjecutar(rol, 'verDocumento')) return false;
  return TIPOS_DOCUMENTO_RESERVADOS.includes(tipoDocumento) ? rol === 'auxiliar' : true;
}
