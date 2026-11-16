// Inicio y cierre de sesión (HU-01, Visión §5.3).
import { Router } from 'express';
import { z } from 'zod';
import { borrarSesion, guardarSesion } from '../middleware/autenticacion.js';

const credenciales = z.object({
  correo: z.string().trim().toLowerCase().pipe(z.email()),
  contrasena: z.string().min(1).max(200),
});

export function crearRutasSesion({ sesion }) {
  const rutas = Router();
  const formulario = (res, estado, datos = {}) =>
    res.status(estado).pagina('iniciar-sesion', { titulo: 'Iniciar sesión', correo: '', error: null, ...datos });

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

  rutas.post('/cerrar-sesion', async (req, res) => {
    if (req.tokenAcceso) await sesion.cerrarSesion(req.tokenAcceso).catch(() => {});
    borrarSesion(res);
    res.redirect('/iniciar-sesion');
  });

  return rutas;
}
