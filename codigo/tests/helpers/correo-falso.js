// Transporte de correo falso: guarda los mensajes en memoria en lugar de enviarlos.
import { crearServicioCorreo } from '../../src/servicios/correo.js';

export const DESTINATARIOS = Object.freeze({
  auxiliar: 'auxiliar1@sigi.test',
  coordinacion: 'coordinacion@sigi.test',
  contabilidad: 'contabilidad1@sigi.test',
  cartera: 'cartera1@sigi.test',
  sgsst: 'sgsst@sigi.test',
  gestionDocumental: 'gestion.documental@sigi.test',
});

export function crearCorreoFalso() {
  const enviados = [];
  const transporte = { sendMail: async (mensaje) => { enviados.push(mensaje); } };
  const correo = crearServicioCorreo({ transporte, remitente: 'SIGI <sigi@sigi.test>', destinatarios: DESTINATARIOS });
  return { correo, enviados };
}
