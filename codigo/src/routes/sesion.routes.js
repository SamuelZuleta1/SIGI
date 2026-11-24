// Inicio y cierre de sesión (HU-01, Visión §5.3).
import { Router } from 'express';
import { z } from 'zod';
import { NOMBRES_DE_ROL } from '../config/permisos.js';
import { borrarSesion, guardarSesion } from '../middleware/autenticacion.js';

const credenciales = z.object({
  correo: z.string().trim().toLowerCase().pipe(z.email()),
  contrasena: z.string().min(1).max(200),
});

/**
 * @param {object} dependencias
 * @param {object} dependencias.sesion servicio de sesión
 * @param {{ contrasena: string, correos: Record<string, string> } | null} [dependencias.accesoRapido]
 *   Acceso rápido: un botón por actor que entra con su usuario de demostración. La contraseña se queda en el
 *   servidor. Si es null (sin DEMO_PASSWORD), ni los botones ni la ruta existen.
 */
export function crearRutasSesion({ sesion, accesoRapido = null }) {
  const rutas = Router();
  const actores = accesoRapido
    ? Object.entries(accesoRapido.correos).map(([rol, correo]) => ({ rol, correo, nombre: NOMBRES_DE_ROL[rol] ?? rol }))
    : [];
  const formulario = (res, estado, datos = {}) =>
    res.status(estado).pagina('iniciar-sesion', { titulo: 'Iniciar sesión', correo: '', error: null, actores, ...datos });

  rutas.get('/iniciar-sesion', (req, res) => (req.usuario ? res.redirect('/') : formulario(res, 200)));

  rutas.post('/iniciar-sesion', async (req, res) => {
    const correo = String(req.body?.correo ?? '').slice(0, 200);
    const datos = credenciales.safeParse(req.body ?? {});
    if (!datos.success) {
      return formulario(res, 400, { correo, error: 'Escriba su correo institucional y su contraseña.' });
    }
    const nueva = await sesion.iniciarSesion(datos.data.correo, datos.data.contrasena);
    if (!nueva) {
      // Mismo mensaje si el correo no existe o la contraseña es incorrecta.
      return formulario(res, 401, { correo, error: 'El correo o la contraseña no son correctos.' });
    }
    guardarSesion(res, nueva);
    res.redirect('/');
  });

  if (accesoRapido) {
    rutas.post('/iniciar-sesion/rapido', async (req, res) => {
      const rol = String(req.body?.rol ?? '');
      const correo = Object.hasOwn(accesoRapido.correos, rol) ? accesoRapido.correos[rol] : null;
      if (!correo) return formulario(res, 400, { error: 'Escoja uno de los usuarios de prueba.' });
      const nueva = await sesion.iniciarSesion(correo, accesoRapido.contrasena);
      if (!nueva) {
        return formulario(res, 401, { error: 'No se pudo entrar con el usuario de prueba. Ejecute npm run db:usuarios.' });
      }
      guardarSesion(res, nueva);
      res.redirect('/');
    });
  }

  rutas.post('/cerrar-sesion', async (req, res) => {
    if (req.tokenAcceso) await sesion.cerrarSesion(req.tokenAcceso).catch(() => {});
    borrarSesion(res);
    res.redirect('/iniciar-sesion');
  });

  return rutas;
}
