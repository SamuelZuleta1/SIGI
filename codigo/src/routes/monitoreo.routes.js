// Grupo `monitoreo` de la Interfaz de incapacidades — DS-10 (CU-14).
// Operaciones de la Vista: consultarReporteProlongadas (HU-22, GET /prolongadas, calculado en el momento: DA-19),
// registrarConcepto (HU-22) y registrarFaltaConcepto (HU-23) y registrarSuspensionPago (HU-24), desde una pantalla por incapacidad prolongada (DA-46).
import { Router } from 'express';
import { CONCEPTO_MAXIMO, DIAS_PROLONGADA } from '../controllers/monitoreo.controller.js';
import { ErrorDeAviso } from '../controllers/error-de-aviso.js';
import { ErrorDeValidacion } from '../controllers/error-de-validacion.js';
import { responderAvisoFallido } from './aviso-fallido.js';
import { permitir } from '../middleware/autenticacion.js';
import { NOMBRES_TIPO_INCAPACIDAD } from '../models/incapacidad.model.js';
import { fechaBreve } from '../servicios/dias-habiles.js';

export function crearRutasMonitoreo({ control }) {
  const rutas = Router();

  const pagina = (res, estado, datos) =>
    res.status(estado).pagina('monitoreo/registrar-concepto', {
      titulo: 'Incapacidad prolongada',
      errores: {},
      valores: {},
      conceptoRegistrado: false,
      faltaRegistrada: false,
      suspensionConfirmada: false,
      fechaBreve,
      nombresTipo: NOMBRES_TIPO_INCAPACIDAD,
      conceptoMaximo: CONCEPTO_MAXIMO,
      diasProlongada: DIAS_PROLONGADA,
      ...datos,
    });

  const noExiste = (res) =>
    res.status(404).pagina('error', {
      titulo: 'Incapacidad no encontrada',
      mensaje: `No hay una incapacidad prolongada (más de ${DIAS_PROLONGADA} días) con ese número.`,
    });

  // consultarReporteProlongadas() — HU-22.CA1. Solo consulta.
  rutas.get('/prolongadas', permitir('consultarReporteProlongadas'), async (req, res) => {
    const datos = await control.consultarReporteProlongadas(String(req.query.ver ?? 'accion'));
    res.pagina('monitoreo/consultar-prolongadas', {
      titulo: 'Prolongadas',
      ...datos,
      fechaBreve,
      nombresTipo: NOMBRES_TIPO_INCAPACIDAD,
      diasProlongada: DIAS_PROLONGADA,
    });
  });

  // Tras registrar se vuelve con ?concepto=1 o ?falta=1; la confirmación solo aparece si de verdad quedó registrado.
  rutas.get('/incapacidades/:id/prolongada', permitir('consultarReporteProlongadas'), async (req, res) => {
    const prolongada = await control.prepararProlongada(req.params.id);
    if (!prolongada) return noExiste(res);
    await pagina(res, 200, {
      prolongada,
      conceptoRegistrado: req.query.concepto === '1' && prolongada.estadoConcepto === 'registrado',
      faltaRegistrada: req.query.falta === '1' && prolongada.estadoConcepto === 'falta',
      suspensionConfirmada: req.query.suspension === '1' && prolongada.suspensionRegistrada,
    });
  });

  const volverAlFormulario = async (req, res, estado, errores, valores = {}) => {
    const prolongada = await control.prepararProlongada(req.params.id);
    if (!prolongada) return noExiste(res);
    await pagina(res, estado, { prolongada, errores, valores });
  };

  // Datos no válidos: 400; el estado no lo admite: 409; el correo falló: 502 (deshecho) o 500 (ver aviso-fallido.js).
  const volverConErrores = (req, res, error, valores = {}) => {
    if (error instanceof ErrorDeAviso) {
      return responderAvisoFallido(res, error, {
        destinatario: 'al colaborador',
        volverAlFormulario: (estado, errores) => volverAlFormulario(req, res, estado, errores, valores),
      });
    }
    if (!(error instanceof ErrorDeValidacion)) throw error;
    return volverAlFormulario(req, res, error.errores.estado || error.errores.suspension ? 409 : 400, error.errores, valores);
  };

  // registrarConcepto(concepto) — HU-22.CA2. Concepto no válido: 400; ya registrado o no prolongada: 409.
  rutas.post('/incapacidades/:id/concepto', permitir('registrarConcepto'), async (req, res) => {
    const concepto = String(req.body?.concepto ?? '');
    try {
      const resultado = await control.registrarConcepto(req.params.id, { concepto });
      if (!resultado) return noExiste(res);
      res.redirect(303, `/incapacidades/${resultado.idIncapacidad}/prolongada?concepto=1`);
    } catch (error) {
      await volverConErrores(req, res, error, { concepto: concepto.slice(0, CONCEPTO_MAXIMO + 1) });
    }
  });

  // registrarFaltaConcepto() — HU-23.CA1. Ya tiene concepto o la falta ya se registró: 409.
  rutas.post('/incapacidades/:id/falta-concepto', permitir('registrarFaltaConcepto'), async (req, res) => {
    try {
      const resultado = await control.registrarFaltaConcepto(req.params.id);
      if (!resultado) return noExiste(res);
      res.redirect(303, `/incapacidades/${resultado.idIncapacidad}/prolongada?falta=1`);
    } catch (error) {
      await volverConErrores(req, res, error);
    }
  });

  // registrarSuspensionPago() — HU-24.CA1. No supera los 180 días o ya se registró: 409.
  rutas.post('/incapacidades/:id/suspension-pago', permitir('registrarSuspensionPago'), async (req, res) => {
    try {
      const resultado = await control.registrarSuspensionPago(req.params.id);
      if (!resultado) return noExiste(res);
      res.redirect(303, `/incapacidades/${resultado.idIncapacidad}/prolongada?suspension=1`);
    } catch (error) {
      await volverConErrores(req, res, error);
    }
  });

  return rutas;
}
