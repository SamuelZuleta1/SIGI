// Sesión + rol + permisos + restricción de historia clínica y epicrisis (F1 §11.1).
// HU-01: sin sesión válida, la petición se rechaza. HU-02 / DA-02: permisos por rol.
import { puedeEjecutar, puedeVerDocumento } from '../config/permisos.js';

export const COOKIE_ACCESO = 'sigi_acceso';
export const COOKIE_RENOVACION = 'sigi_renovacion';

const opcionesCookie = (maxAge) => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge,
});

export function guardarSesion(res, { acceso, renovacion }) {
  res.cookie(COOKIE_ACCESO, acceso, opcionesCookie(60 * 60 * 1000));
  res.cookie(COOKIE_RENOVACION, renovacion, opcionesCookie(7 * 24 * 60 * 60 * 1000));
}

export function borrarSesion(res) {
  res.clearCookie(COOKIE_ACCESO, opcionesCookie());
  res.clearCookie(COOKIE_RENOVACION, opcionesCookie());
}

/** Rechaza los envíos de formularios que vienen de otro sitio (CSRF). */
export function mismoOrigen(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origen = req.get('origin');
  if (origen) {
    let host = null;
    try { host = new URL(origen).host; } catch { /* origen inválido */ }
    if (host !== req.get('host')) return res.status(403).send('Origen no permitido');
  }
  next();
}

/** Lee las cookies y deja en req.usuario { id, correo, rol } si la sesión es válida. */
export function cargarSesion(sesion) {
  return async (req, res, next) => {
    try {
      req.usuario = null;
      const acceso = req.cookies?.[COOKIE_ACCESO];
      const renovacion = req.cookies?.[COOKIE_RENOVACION];

      let idUsuario = acceso ? await sesion.verificar(acceso) : null;
      if (!idUsuario && renovacion) {
        const nueva = await sesion.renovar(renovacion);
        if (nueva) {
          guardarSesion(res, nueva);
          req.tokenAcceso = nueva.acceso;
          idUsuario = nueva.idUsuario;
        }
      } else if (idUsuario) {
        req.tokenAcceso = acceso;
      }

      // Una cuenta sin fila en `usuario` no tiene rol: se trata como sin sesión.
      if (idUsuario) req.usuario = await sesion.obtenerUsuario(idUsuario);
      if (!req.usuario && (acceso || renovacion)) borrarSesion(res);

      res.locals.usuario = req.usuario;
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** HU-01: sin sesión, las páginas llevan al inicio de sesión y lo demás se rechaza con 401. */
export function exigirSesion(req, res, next) {
  if (req.usuario) return next();
  if (req.method === 'GET' || req.method === 'HEAD') return res.redirect('/iniciar-sesion');
  res.status(401).pagina('error', {
    titulo: 'Sesión requerida',
    mensaje: 'Su sesión no es válida o terminó. Inicie sesión de nuevo.',
  });
}

const prohibido = (res) =>
  res.status(403).pagina('error', {
    titulo: 'Sin permiso',
    mensaje: 'Su rol no tiene permiso para esta operación.',
  });

/** DA-02: solo los roles de la operación pueden ejecutarla. */
export function permitir(operacion) {
  return (req, res, next) => (req.usuario && puedeEjecutar(req.usuario.rol, operacion) ? next() : prohibido(res));
}

/**
 * HU-02: restringe la historia clínica y la epicrisis al auxiliar.
 * `obtenerTipo(req)` devuelve el tipo del documento que se pide.
 */
export function restringirDocumento(obtenerTipo) {
  return async (req, res, next) => {
    try {
      const tipo = await obtenerTipo(req);
      return req.usuario && puedeVerDocumento(req.usuario.rol, tipo) ? next() : prohibido(res);
    } catch (error) {
      next(error);
    }
  };
}
