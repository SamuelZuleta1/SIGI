// Composición de la aplicación real (persistencia, correo y sesión desde el entorno).
// La usan `npm start` (src/app.js) y la función de Vercel (api/index.js).
import { crearApp } from './app.js';

export async function crearAppDeProduccion() {
  const { crearServicioSesion } = await import('./servicios/sesion.js');
  const { crearBaseDeDatos } = await import('./persistence/base-de-datos.js');
  const { crearControlIncapacidades } = await import('./controllers/control-incapacidades.js');
  const { crearServicioCorreo } = await import('./servicios/correo.js');
  const { crearTransporte, destinatariosPorArea, remitente } = await import('./config/correo.js');
  const { configurarAccesoRapido } = await import('./config/acceso-rapido.js');
  const correo = crearServicioCorreo({ transporte: crearTransporte(), remitente: remitente(), destinatarios: destinatariosPorArea() });
  const control = crearControlIncapacidades({ baseDeDatos: crearBaseDeDatos(), correo });
  return crearApp({ sesion: crearServicioSesion(), control, accesoRapido: configurarAccesoRapido() });
}
