// Grupo `radicacion` de la Interfaz de incapacidades — DS-04 (CU-06).
// Operaciones de la Vista: prepararRadicacion (HU-09), registrarRadicacion (HU-10) y «ver evidencia».
import { Router } from 'express';
import multer from 'multer';
import { TAMANO_MAXIMO_ARCHIVO } from '../controllers/archivo.js';
import { ErrorDeValidacion } from '../controllers/error-de-validacion.js';
import { LARGO_MAXIMO_RADICADO } from '../controllers/radicacion.controller.js';
import { permitir } from '../middleware/autenticacion.js';
import { NOMBRES_ESTADO_INCAPACIDAD, NOMBRES_TIPO_INCAPACIDAD } from '../models/incapacidad.model.js';
import { fechaBreve, fechaEnColombia, fechaLarga } from '../servicios/dias-habiles.js';
import { archivosDePeticion, MENSAJE_SUBIDA_PERDIDA } from './subidas.js';

// La evidencia (P-D) se recibe en memoria y el Control la pasa al bucket privado: nunca toca el disco.
const recibirEvidencia = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANO_MAXIMO_ARCHIVO, files: 1, fields: 1, fieldSize: 1024 },
}).single('evidencia');

export function crearRutasRadicacion({ control }) {
  const rutas = Router();

  const pagina = (res, estado, datos = {}) =>
    res.status(estado).pagina('radicacion/preparar-radicacion', {
      titulo: 'Preparar radicación',
      radicacion: null,
      numero: '',
      errorNumero: null,
      errores: {},
      valores: {},
      registrada: false,
      largoRadicado: LARGO_MAXIMO_RADICADO,
      fechaLarga,
      fechaBreve,
      fechaEnColombia,
      nombresTipo: NOMBRES_TIPO_INCAPACIDAD,
      nombresEstado: NOMBRES_ESTADO_INCAPACIDAD,
      ...datos,
    });

  // Entrada del menú: pide el número de la incapacidad y lleva a su radicación.
  rutas.get('/radicacion', permitir('prepararRadicacion'), async (req, res) => {
    const numero = String(req.query.incapacidad ?? '').trim().slice(0, 20);
    if (!numero) return pagina(res, 200);
    const radicacion = await control.prepararRadicacion(numero);
    if (!radicacion) return pagina(res, 404, { numero, errorNumero: 'No hay una incapacidad con ese número.' });
    res.redirect(303, `/incapacidades/${radicacion.incapacidad.idIncapacidad}/radicacion`);
  });

  const noExiste = (res, numero) =>
    pagina(res, 404, { numero: String(numero ?? '').slice(0, 20), errorNumero: 'No hay una incapacidad con ese número.' });

  // prepararRadicacion → datosRadicacion (HU-09.CA1). Plazo por vencer o vencido: se advierte y se
  // responde 200, sin bloquear (HU-09.CA2, DA-14). Tras registrar, se vuelve con ?registrada=1 (HU-10).
  rutas.get('/incapacidades/:id/radicacion', permitir('prepararRadicacion'), async (req, res) => {
    const radicacion = await control.prepararRadicacion(req.params.id);
    if (!radicacion) return noExiste(res, req.params.id);
    await pagina(res, 200, { radicacion, registrada: req.query.registrada === '1' });
  });

  // registrarRadicacion(radicado, evidencia) — HU-10. Datos no válidos: 400; el estado no admite radicar
  // (ya transcrita, cobrada o pagada; DA-36): 409.
  rutas.post(
    '/incapacidades/:id/radicacion',
    permitir('registrarRadicacion'),
    (req, res, next) =>
      recibirEvidencia(req, res, (error) => {
        if (!error) return next();
        if (!(error instanceof multer.MulterError)) return next(error);
        // Cada límite se informa en el campo que lo causó.
        req.errorDeSubida =
          error.code === 'LIMIT_FILE_SIZE'
            ? { evidencia: 'El archivo pesa más de 10 MB.' }
            : error.code === 'LIMIT_FIELD_VALUE'
              ? { radicado: `El número de radicado admite máximo ${LARGO_MAXIMO_RADICADO} caracteres.` }
              : { evidencia: 'No se pudo recibir la evidencia. Revise e intente de nuevo.' };
        next();
      }),
    async (req, res) => {
      const radicado = String(req.body?.radicado ?? '');
      const { archivos, rutas: subidas, perdidos } = await archivosDePeticion(control, req, ['evidencia']);
      try {
        if (req.errorDeSubida) throw new ErrorDeValidacion(req.errorDeSubida);
        if (perdidos.length > 0) throw new ErrorDeValidacion({ evidencia: MENSAJE_SUBIDA_PERDIDA });
        const resultado = await control.registrarRadicacion(req.params.id, { radicado, evidencia: archivos.evidencia }, req.usuario);
        if (!resultado) return noExiste(res, req.params.id);
        res.redirect(303, `/incapacidades/${resultado.idIncapacidad}/radicacion?registrada=1`);
      } catch (error) {
        if (!(error instanceof ErrorDeValidacion)) throw error;
        const radicacion = await control.prepararRadicacion(req.params.id);
        if (!radicacion) return noExiste(res, req.params.id);
        const estado = error.errores.estado ? 409 : 400;
        await pagina(res, estado, { radicacion, errores: error.errores, valores: { radicado: radicado.slice(0, LARGO_MAXIMO_RADICADO) } });
      } finally {
        await control.descartarSubidas(subidas, req.usuario).catch((error) => console.error('No se pudieron borrar las subidas:', error));
      }
    },
  );

  // Ver la evidencia de una radicación: la entrega el servidor desde el bucket privado (como DA-06).
  rutas.get('/radicaciones/:id/evidencia', permitir('prepararRadicacion'), async (req, res) => {
    const radicacion = await control.obtenerRadicacion(req.params.id);
    if (!radicacion) {
      return res.status(404).pagina('error', { titulo: 'Evidencia no encontrada', mensaje: 'La evidencia que busca no existe.' });
    }
    const { contenido, tipoMime, nombre } = await control.verEvidencia(radicacion);
    res.set({
      'Content-Type': tipoMime,
      'Content-Disposition': `${tipoMime === 'application/octet-stream' ? 'attachment' : 'inline'}; filename="${nombre}"`,
      'Cache-Control': 'no-store',
    });
    res.send(contenido);
  });

  return rutas;
}
