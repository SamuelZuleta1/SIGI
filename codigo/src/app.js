// Arranque de Express (F1 §11.2).
// `crearApp` recibe sus dependencias para poder probarla con persistencia y correo falsos.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import { cargarSesion, mismoOrigen } from './middleware/autenticacion.js';
import { NOMBRES_DE_ROL, PAGINA_DE_ENTRADA, puedeEjecutar } from './config/permisos.js';
import { crearRutas } from './routes/index.js';

const directorio = path.dirname(fileURLToPath(import.meta.url));

// Origen de Supabase: el navegador sube allí los archivos grandes con una URL firmada (Vercel limita la petición a 4,5 MB).
const origenDeSupabase = () => {
  try {
    return new URL(process.env.SUPABASE_URL ?? '').origin;
  } catch {
    return '';
  }
};

export function crearApp(dependencias) {
  if (!dependencias?.sesion) throw new Error('crearApp necesita el servicio de sesión');
  const conectar = ['\'self\'', origenDeSupabase()].filter(Boolean).join(' ');
  const app = express();

  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', path.join(directorio, 'views'));

  // Cabeceras de seguridad básicas (RNF-02).
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy':
        `default-src 'self'; connect-src ${conectar}; img-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`,
    });
    next();
  });

  app.use(express.static(path.join(directorio, '..', 'public')));
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  app.use(mismoOrigen);

  // res.pagina(vista, datos): dibuja la vista dentro de layout.ejs.
  app.use((req, res, next) => {
    res.pagina = (vista, datos = {}) => {
      res.render(vista, datos, (error, cuerpo) => {
        if (error) return next(error);
        const usuario = res.locals.usuario ?? null;
        res.render('layout', {
          titulo: datos.titulo ?? 'SIGI',
          cuerpo,
          usuario,
          nombreRol: usuario ? NOMBRES_DE_ROL[usuario.rol] : null,
          ruta: req.path,
          paginaEntrada: usuario ? PAGINA_DE_ENTRADA[usuario.rol] : null,
          puede: (operacion) => Boolean(usuario) && puedeEjecutar(usuario.rol, operacion),
        });
      });
    };
    next();
  });

  app.use(cargarSesion(dependencias.sesion));
  app.use(crearRutas(dependencias));

  app.use((req, res) => {
    res.status(404).pagina('error', { titulo: 'Página no encontrada', mensaje: 'La página que busca no existe.' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    console.error(error);
    res.status(500).pagina('error', {
      titulo: 'Error',
      mensaje: 'Ocurrió un error inesperado. Intente de nuevo.',
    });
  });

  return app;
}
