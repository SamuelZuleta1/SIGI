// Configuración del correo SMTP (F1 §2.6).
// En desarrollo y demostración apunta a Mailpit (DA-02 e); en producción solo cambian las variables.
import 'dotenv/config';
import nodemailer from 'nodemailer';

export function crearTransporte() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_PORT) {
    throw new Error('Faltan SMTP_HOST y SMTP_PORT (ver .env.example)');
  }
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
}

export const remitente = () => process.env.SMTP_FROM || 'SIGI <sigi@sigi.test>';

/** Buzones de las áreas que reciben notificaciones (CONTEXTO §8). */
export function destinatariosPorArea() {
  const areas = {
    auxiliar: process.env.CORREO_AUXILIAR,
    coordinacion: process.env.CORREO_COORDINACION,
    contabilidad: process.env.CORREO_CONTABILIDAD,
    cartera: process.env.CORREO_CARTERA,
    sgsst: process.env.CORREO_SGSST,
    gestionDocumental: process.env.CORREO_GESTION_DOCUMENTAL,
  };
  const faltan = Object.entries(areas).filter(([, v]) => !v).map(([k]) => k);
  if (faltan.length) throw new Error(`Faltan los correos de: ${faltan.join(', ')} (ver .env.example)`);
  return areas;
}
