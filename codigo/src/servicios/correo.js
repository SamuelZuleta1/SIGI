// Servicio de correo: las 13 notificaciones del diseño (F1 §6.4.4, CONTEXTO §8).
// El transporte se inyecta: SMTP real (Mailpit en la demostración) o uno falso en las pruebas.
//
// Ningún correo lleva adjuntos ni información clínica (CAR-11, DA-12):
// solo los datos de identificación del trámite.

import { NOMBRES_ESTADO_INCAPACIDAD } from '../models/incapacidad.model.js';
import { pesos } from './moneda.js';

const escapar = (texto) =>
  String(texto ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const TIPOS = {
  enfermedad_general: 'Enfermedad general',
  accidente_laboral: 'Accidente laboral',
  enfermedad_laboral: 'Enfermedad laboral',
  accidente_transito: 'Accidente de tránsito',
  licencia_maternidad: 'Licencia de maternidad',
  licencia_paternidad: 'Licencia de paternidad',
};

// Líneas que identifican la incapacidad en cualquier correo.
const resumen = (i) => [
  `Incapacidad n.º ${i.idIncapacidad}`,
  `Colaborador: ${i.colaborador}`,
  `Tipo: ${TIPOS[i.tipo] ?? i.tipo}`,
  `Entidad: ${i.entidad}`,
  `Fecha de inicio: ${i.fechaInicio} · Días: ${i.diasIncapacidad}`,
];

const lista = (elementos) => elementos.map((e) => `- ${e}`);

// Pesos con centavos cuando los hay (DA-40): un valor consignado de $ 420.000,50 no se redondea en el correo.
const moneda = pesos;

/**
 * @param {object} deps
 * @param {{ sendMail: Function }} deps.transporte  transporte de nodemailer (o uno falso)
 * @param {string} deps.remitente
 * @param {{ auxiliar, coordinacion, contabilidad, cartera, sgsst, gestionDocumental }} deps.destinatarios
 */
export function crearServicioCorreo({ transporte, remitente, destinatarios }) {
  async function enviar(para, asunto, lineas) {
    if (!para) throw new Error(`Sin destinatario para el correo «${asunto}»`);
    const text = lineas.join('\n');
    const html = lineas.map((l) => (l === '' ? '<br>' : `<p style="margin:0 0 4px">${escapar(l)}</p>`)).join('');
    const mensaje = { from: remitente, to: para, subject: `[SIGI] ${asunto}`, text, html };
    await transporte.sendMail(mensaje);
    return mensaje;
  }

  return {
    // DS-01 → Auxiliar
    notificarRecepcion: (incapacidad) =>
      enviar(destinatarios.auxiliar, `Documentos recibidos — incapacidad n.º ${incapacidad.idIncapacidad}`, [
        'Se registró la documentación de una incapacidad. Está lista para verificar.',
        '',
        ...resumen(incapacidad),
      ]),

    // DS-03 → Colaborador (plazo: 3 días hábiles)
    notificarFaltantes: (incapacidad, faltantes, fechaLimite) =>
      enviar(incapacidad.correoColaborador, 'Documentos faltantes de su incapacidad', [
        `Hola, ${incapacidad.colaborador}.`,
        'Para tramitar su incapacidad hacen falta los siguientes documentos:',
        ...lista(faltantes),
        '',
        `Tiene 3 días hábiles para entregarlos${fechaLimite ? ` (hasta el ${fechaLimite})` : ''}.`,
        '',
        `Incapacidad n.º ${incapacidad.idIncapacidad} · Fecha de inicio: ${incapacidad.fechaInicio}`,
      ]),

    // DS-03 → Coordinación (segundo llamado)
    notificarCitacion: (incapacidad, { fechaAviso, fechaLimite } = {}) =>
      enviar(destinatarios.coordinacion, `Citación por documentos pendientes — incapacidad n.º ${incapacidad.idIncapacidad}`, [
        'Se registró el segundo llamado: el colaborador no entregó los documentos faltantes en el plazo.',
        'Se solicita citar al colaborador.',
        ...(fechaAviso ? [`Aviso de faltantes: ${fechaAviso} · plazo vencido el ${fechaLimite}.`] : []),
        '',
        ...resumen(incapacidad),
        `Correo del colaborador: ${incapacidad.correoColaborador ?? 'sin dato'}`,
        'Documentos pendientes:',
        ...lista(incapacidad.faltantes ?? []),
      ]),

    // DS-07 → Coordinación (HU-17.CA1). Con la fecha prometida y los días de demora cuando se conocen (DA-42),
    // para que la Coordinación negocie el acuerdo de pago con la entidad.
    notificarRetraso: (incapacidad) =>
      enviar(destinatarios.coordinacion, `Retraso en el pago — incapacidad n.º ${incapacidad.idIncapacidad}`, [
        'El pago de esta incapacidad superó el tiempo informado por la entidad.',
        `Tiempo de pago informado: ${incapacidad.tiempoPago == null ? 'sin dato' : incapacidad.tiempoPago === 1 ? '1 día' : `${incapacidad.tiempoPago} días`}`,
        ...(incapacidad.fechaPrometida ? [`Debía pagar a más tardar: ${incapacidad.fechaPrometida}`] : []),
        ...(incapacidad.diasDemora ? [`Días de demora: ${incapacidad.diasDemora}`] : []),
        'Si acuerdan con la entidad una fecha y un valor de pago, comuníquelos al auxiliar para registrarlos en SIGI.',
        '',
        ...resumen(incapacidad),
      ]),

    // DS-08 → Cartera y Jurídica
    notificarTraslado: (incapacidad, motivo) =>
      enviar(destinatarios.cartera, `Traslado a Cartera y Jurídica — incapacidad n.º ${incapacidad.idIncapacidad}`, [
        'Se traslada esta incapacidad para cobro jurídico.',
        `Motivo: ${motivo}`,
        '',
        ...resumen(incapacidad),
      ]),

    // DS-10 → Colaborador. Solo el aviso: el texto del concepto es información clínica y no va en el correo (DA-52).
    comunicarConcepto: (incapacidad) =>
      enviar(incapacidad.correoColaborador, 'Concepto de rehabilitación de su incapacidad', [
        `Hola, ${incapacidad.colaborador}.`,
        'Se registró en SIGI el concepto de rehabilitación que emitió la entidad para su incapacidad.',
        'Si necesita conocerlo, consúltelo con Gestión Humana.',
        '',
        `Incapacidad n.º ${incapacidad.idIncapacidad} · Fecha de inicio: ${incapacidad.fechaInicio}`,
      ]),

    // DS-10 → Colaborador
    avisarFaltaConcepto: (incapacidad) =>
      enviar(incapacidad.correoColaborador, 'Falta el concepto de rehabilitación de su incapacidad', [
        `Hola, ${incapacidad.colaborador}.`,
        'Su incapacidad no tiene concepto de rehabilitación. Debe solicitarlo a su EPS.',
        '',
        `Incapacidad n.º ${incapacidad.idIncapacidad} · Fecha de inicio: ${incapacidad.fechaInicio}`,
      ]),

    // DS-10 → Colaborador (más de 180 días)
    notificarSuspensionPago: (incapacidad) =>
      enviar(incapacidad.correoColaborador, 'Suspensión del pago de su incapacidad', [
        `Hola, ${incapacidad.colaborador}.`,
        'Su incapacidad superó los 180 días, por lo que se suspende el pago por parte de la empresa.',
        'El reconocimiento se tramita ante el fondo de pensiones o la EPS.',
        '',
        `Incapacidad n.º ${incapacidad.idIncapacidad} · Fecha de inicio: ${incapacidad.fechaInicio}`,
      ]),

    // DS-11 → Auxiliar
    notificarPagosPorIdentificar: (entidad, cantidad) =>
      enviar(destinatarios.auxiliar, `Pagos por identificar — ${entidad}`, [
        `Contabilidad y Tesorería registró ${cantidad} pago(s) consignado(s) de ${entidad}.`,
        'Están pendientes de identificar y conciliar.',
      ]),

    // DS-11 → Contabilidad y Tesorería
    enviarDetalleConciliado: (entidad, detalle) =>
      enviar(destinatarios.contabilidad, `Detalle conciliado — ${entidad}`, [
        `Todos los pagos consignados de ${entidad} quedaron identificados y conciliados.`,
        '',
        'Detalle conciliado:',
        ...lista(detalle.map((d) => `${d.colaborador} · ${d.diasPagados} día(s) · ${moneda(d.valor)}${d.idIncapacidad ? ` · incapacidad n.º ${d.idIncapacidad}` : ''}`)),
        `Total: ${moneda(detalle.reduce((t, d) => t + Math.round(Number(d.valor) * 100), 0) / 100)}`,
      ]),

    // DS-11 → Contabilidad y Tesorería (DA-56): los consignados sin identificar y los pagos registrados en SIGI que
    // no aparecen en lo consignado. `identificados`: cuántos sí se conciliaron en la misma revisión.
    notificarSaldosPendientes: (entidad, saldos, identificados = 0) => {
      const consignados = saldos.filter((s) => s.tipo !== 'pago');
      const sinConsignar = saldos.filter((s) => s.tipo === 'pago');
      return enviar(destinatarios.contabilidad, `Saldos pendientes por identificar — ${entidad}`, [
        `Al conciliar los pagos de ${entidad} quedaron saldos sin identificar.`,
        ...(identificados > 0 ? [`Se identificaron y conciliaron ${identificados} pago(s).`] : []),
        ...(consignados.length > 0
          ? ['', 'Pagos consignados que no se pudieron identificar:', ...lista(consignados.map((s) => `${s.colaborador} · ${s.diasPagados} día(s) · ${moneda(s.valor)}`))]
          : []),
        ...(sinConsignar.length > 0
          ? ['', 'Pagos registrados en SIGI que no aparecen en lo consignado:', ...lista(sinConsignar.map((s) => `${s.colaborador} · incapacidad n.º ${s.idIncapacidad} · ${moneda(s.valor)}`))]
          : []),
      ]);
    },

    // DS-12 → SG-SST (contenido: DA-21, DA-57)
    enviarReporteAusentismo: (periodo, contenido) =>
      enviar(destinatarios.sgsst, `Reporte de ausentismo — ${periodo}`, [
        `Reporte de ausentismo del periodo ${periodo}: ${contenido.length} incapacidad(es), ` +
          `${contenido.reduce((s, f) => s + f.diasEnPeriodo, 0)} día(s) de ausencia en el periodo.`,
        '',
        ...lista(
          contenido.map(
            (f) =>
              `${f.colaborador} · ${TIPOS[f.tipo] ?? f.tipo} · ${f.entidad} · inicio ${f.fechaInicio} · ` +
              `${f.diasIncapacidad} día(s), ${f.diasEnPeriodo} en el periodo · ${NOMBRES_ESTADO_INCAPACIDAD[f.estado] ?? f.estado}`,
          ),
        ),
      ]),

    // DS-13 → Gestión Documental (solo datos, sin adjuntos: DA-12)
    enviarParaArchivo: (incapacidad) =>
      enviar(destinatarios.gestionDocumental, `Incapacidad pagada para archivo — n.º ${incapacidad.idIncapacidad}`, [
        'Esta incapacidad está pagada y conciliada. Se envía para archivo.',
        '',
        ...resumen(incapacidad),
      ]),
  };
}
