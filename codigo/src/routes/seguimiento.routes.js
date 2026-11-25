// Grupo `seguimiento` de la Interfaz de incapacidades — DS-07 (CU-11).
// Operaciones de la Vista: consultarPendientesDePago (HU-16.CA1), registrarSeguimiento (HU-16.CA3, con el aviso de
// retraso de HU-17.CA1), registrarAcuerdo (HU-17.CA2) y «ver evidencia».
// El pago que se conoce en el seguimiento va a POST /incapacidades/:id/pago con origen=seguimiento (HU-16.CA2).
// Diseño (DA-41): lista con pestañas «Todas / Con demora / Toca esta semana» y, por incapacidad, la línea de tiempo del
// seguimiento con el segmento «Sigue pendiente / Ya pagó» (el mismo patrón de la respuesta de la entidad, DA-39).
import { Router } from 'express';
import multer from 'multer';
import { TAMANO_MAXIMO_ARCHIVO } from '../controllers/archivo.js';
import { ErrorDeAviso } from '../controllers/error-de-aviso.js';
import { ErrorDeValidacion } from '../controllers/error-de-validacion.js';
import { permitir } from '../middleware/autenticacion.js';
import { NOMBRES_TIPO_INCAPACIDAD } from '../models/incapacidad.model.js';
import { fechaBreve, fechaEnColombia, fechaLarga, sumarIntervalo } from '../servicios/dias-habiles.js';
import { ACUERDO_DIAS_MAXIMO } from '../controllers/seguimiento.controller.js';
import { pesos } from '../servicios/moneda.js';
import { responderAvisoFallido } from './aviso-fallido.js';

// La evidencia (P-D) se recibe en memoria y la Persistencia la pasa al bucket privado: nunca toca el disco.
const recibirEvidencia = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANO_MAXIMO_ARCHIVO, files: 1, fields: 0 },
}).single('evidencia');

export function crearRutasSeguimiento({ control }) {
  const rutas = Router();

  const formatos = { fechaBreve, fechaLarga, fechaEnColombia, sumarIntervalo, acuerdoDiasMaximo: ACUERDO_DIAS_MAXIMO, pesos, nombresTipo: NOMBRES_TIPO_INCAPACIDAD };

  const pagina = (res, estado, datos = {}) =>
    res.status(estado).pagina('seguimiento/registrar-seguimiento', {
      titulo: 'Seguimiento del cobro',
      errores: {},
      valores: {},
      accion: 'seguimiento',
      registrado: false,
      pagoRegistrado: false,
      acuerdoRegistrado: false,
      ...formatos,
      ...datos,
    });

  const noExiste = (res) =>
    res.status(404).pagina('error', { titulo: 'Incapacidad no encontrada', mensaje: 'No hay una incapacidad con ese número.' });

  // DS-07: consultarPendientesDePago → mostrarPendientes (HU-16.CA1). Solo consulta.
  rutas.get('/seguimiento', permitir('consultarPendientesDePago'), async (req, res) => {
    const datos = await control.consultarPendientesDePago(String(req.query.ver ?? 'todas'));
    res.pagina('seguimiento/consultar-pendientes', { titulo: 'Seguimiento semanal', ...datos, ...formatos });
  });

  // Seguimiento de una incapacidad. ?accion=pago abre «Ya pagó» sin JavaScript. Tras registrar se vuelve con
  // ?registrado=1 (HU-16.CA3, muestra la demora) o ?pagado=1 (HU-16.CA2); la confirmación solo aparece si de verdad
  // ocurrió (un enlace copiado no la muestra).
  rutas.get('/incapacidades/:id/seguimiento', permitir('registrarSeguimiento'), async (req, res) => {
    const seguimiento = await control.prepararSeguimiento(req.params.id);
    if (!seguimiento) return noExiste(res);
    const { incapacidad } = seguimiento;
    const accion =
      req.query.accion === 'pago' ? 'pago' : req.query.accion === 'acuerdo' && seguimiento.puedeRegistrarAcuerdo ? 'acuerdo' : 'seguimiento';
    await pagina(res, 200, {
      seguimiento,
      accion,
      registrado: req.query.registrado === '1' && seguimiento.pendiente && incapacidad.seguimientos.length > 0,
      pagoRegistrado: req.query.pagado === '1' && incapacidad.estado === 'pagada',
      acuerdoRegistrado: req.query.acuerdo === '1' && incapacidad.acuerdos.length > 0,
    });
  });

  // registrarSeguimiento(evidencia) — HU-16.CA3. Evidencia no válida: 400; no está pendiente de pago: 409;
  // con demora y el aviso de retraso (HU-17.CA1) falló: 502, sin guardar nada.
  rutas.post(
    '/incapacidades/:id/seguimiento',
    permitir('registrarSeguimiento'),
    (req, res, next) =>
      recibirEvidencia(req, res, (error) => {
        if (!error) return next();
        if (!(error instanceof multer.MulterError)) return next(error);
        req.errorDeSubida =
          error.code === 'LIMIT_FILE_SIZE'
            ? { evidencia: 'El archivo pesa más de 10 MB.' }
            : { evidencia: 'No se pudo recibir la evidencia. Revise e intente de nuevo.' };
        next();
      }),
    async (req, res) => {
      try {
        if (req.errorDeSubida) throw new ErrorDeValidacion(req.errorDeSubida);
        const resultado = await control.registrarSeguimiento(req.params.id, { evidencia: req.file?.buffer }, req.usuario);
        if (!resultado) return noExiste(res);
        res.redirect(303, `/incapacidades/${resultado.idIncapacidad}/seguimiento?registrado=1`);
      } catch (error) {
        if (error instanceof ErrorDeAviso) {
          return responderAvisoFallido(res, error, {
            destinatario: 'a la Coordinación del retraso',
            volverAlFormulario: async (estado, errores) => {
              const seguimiento = await control.prepararSeguimiento(req.params.id);
              if (!seguimiento) return noExiste(res);
              await pagina(res, estado, { seguimiento, errores: { estado: errores.aviso } });
            },
          });
        }
        if (!(error instanceof ErrorDeValidacion)) throw error;
        const seguimiento = await control.prepararSeguimiento(req.params.id);
        if (!seguimiento) return noExiste(res);
        await pagina(res, error.errores.estado ? 409 : 400, { seguimiento, errores: error.errores });
      }
    },
  );

  // registrarAcuerdo(acuerdo) — HU-17.CA2. Fecha o valor no válidos: 400; sin demora o no pendiente: 409.
  rutas.post('/incapacidades/:id/acuerdo', permitir('registrarAcuerdo'), async (req, res) => {
    const fecha = String(req.body?.fecha ?? '');
    const valor = String(req.body?.valor ?? '');
    try {
      const resultado = await control.registrarAcuerdo(req.params.id, { fecha, valor }, req.usuario);
      if (!resultado) return noExiste(res);
      res.redirect(303, `/incapacidades/${resultado.idIncapacidad}/seguimiento?acuerdo=1`);
    } catch (error) {
      if (!(error instanceof ErrorDeValidacion)) throw error;
      const seguimiento = await control.prepararSeguimiento(req.params.id);
      if (!seguimiento) return noExiste(res);
      await pagina(res, error.errores.estado ? 409 : 400, {
        seguimiento,
        accion: seguimiento.puedeRegistrarAcuerdo ? 'acuerdo' : 'seguimiento',
        errores: error.errores,
        valores: { fechaAcuerdo: fecha.trim().slice(0, 10), valorAcuerdo: valor.trim().slice(0, 30) },
      });
    }
  });

  // Ver la evidencia de un seguimiento: la entrega el servidor desde el bucket privado (como DA-06).
  rutas.get('/seguimientos/:id/evidencia', permitir('registrarSeguimiento'), async (req, res) => {
    const seguimiento = await control.obtenerSeguimiento(req.params.id);
    if (!seguimiento) {
      return res.status(404).pagina('error', { titulo: 'Evidencia no encontrada', mensaje: 'La evidencia que busca no existe.' });
    }
    const { contenido, tipoMime, nombre } = await control.verEvidenciaSeguimiento(seguimiento);
    res.set({
      'Content-Type': tipoMime,
      'Content-Disposition': `${tipoMime === 'application/octet-stream' ? 'attachment' : 'inline'}; filename="${nombre}"`,
      'Cache-Control': 'no-store',
    });
    res.send(contenido);
  });

  return rutas;
}
