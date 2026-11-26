// Subida directa de archivos grandes (Vercel limita la petición a 4,5 MB): el navegador pide aquí una URL firmada, sube
// el archivo al bucket privado y el formulario solo envía su referencia (`subida_<campo>`). Sin JavaScript, el formulario
// sigue enviando el archivo en la propia petición.
import { Router } from 'express';
import { puedeEjecutar } from '../config/permisos.js';
import { prohibido } from '../middleware/autenticacion.js';

const OPERACIONES_CON_ARCHIVO = ['registrarDocumentos', 'registrarRadicacion', 'registrarSeguimiento'];

/**
 * DA-71: responde a «ver archivo» con un 303 al enlace firmado (60 s) del bucket privado; el permiso ya se comprobó en la
 * ruta. Sin caché. Si el archivo no está en el bucket, la página de «no encontrado».
 */
export function redirigirAlArchivo(res, enlace, noEncontrado) {
  if (!enlace) return res.status(404).pagina('error', noEncontrado);
  // Sin cuerpo: res.redirect() lo llenaría con la URL.
  return res.status(303).set({ Location: enlace.url, 'Cache-Control': 'no-store' }).end();
}

export const MENSAJE_SUBIDA_PERDIDA = 'El archivo no llegó completo. Adjúntelo de nuevo.';

export function crearRutasSubidas({ control }) {
  const rutas = Router();

  // POST /subidas → { ruta, urlFirmada }. Solo quien registra algo con archivo; no recibe ningún dato del cliente.
  rutas.post('/subidas', (req, res) => {
    if (!req.usuario || !OPERACIONES_CON_ARCHIVO.some((operacion) => puedeEjecutar(req.usuario.rol, operacion))) return prohibido(res);
    return control
      .prepararSubida(req.usuario)
      .then((subida) => res.set('Cache-Control', 'no-store').json(subida))
      .catch((error) => {
        console.error('No se pudo preparar la subida:', error);
        res.status(502).json({ error: 'No se pudo preparar la subida. Intente de nuevo.' });
      });
  });

  return rutas;
}

/**
 * Archivos de una petición: los del formulario (multipart) o, si el navegador los subió directo, los que están en el
 * bucket (`subida_<campo>`). Devuelve { archivos: {campo: Buffer}, rutas (para descartar), perdidos: [campos] }.
 */
export async function archivosDePeticion(control, req, campos) {
  const archivos = {};
  const rutas = [];
  const perdidos = [];
  for (const campo of campos) {
    const recibido = req.files?.[campo]?.[0] ?? (req.file?.fieldname === campo ? req.file : null);
    if (recibido) {
      archivos[campo] = recibido.buffer;
      continue;
    }
    const ruta = req.body?.[`subida_${campo}`];
    if (typeof ruta !== 'string' || ruta === '') continue;
    rutas.push(ruta);
    const contenido = await control.leerSubida(ruta, req.usuario);
    if (contenido) archivos[campo] = contenido;
    else perdidos.push(campo);
  }
  return { archivos, rutas, perdidos };
}
