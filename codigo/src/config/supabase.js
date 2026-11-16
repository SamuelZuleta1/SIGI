// Cliente de Supabase del servidor (F1 §2.6).
// Usa la clave service role: este módulo NUNCA debe enviarse al navegador.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

export const BUCKET_DOCUMENTOS = 'documentos';

function requerida(nombre) {
  const valor = process.env[nombre];
  if (!valor) throw new Error(`Falta la variable de entorno ${nombre} (ver .env.example)`);
  return valor;
}

const opciones = { auth: { persistSession: false, autoRefreshToken: false } };

/** Cliente con la clave service role: acceso a datos y a Storage desde el servidor. */
export function crearClienteServidor() {
  return createClient(requerida('SUPABASE_URL'), requerida('SUPABASE_SERVICE_ROLE_KEY'), opciones);
}

/** Cliente con la clave pública: solo para iniciar sesión (HU-01). No lee tablas (RLS). */
export function crearClientePublico() {
  return createClient(requerida('SUPABASE_URL'), requerida('SUPABASE_ANON_KEY'), opciones);
}
