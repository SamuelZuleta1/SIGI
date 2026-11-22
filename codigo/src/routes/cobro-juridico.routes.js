// Grupo `cobro-juridico` de la Interfaz de incapacidades — DS-08 (CU-12).
// Operaciones de la Vista: registrarRequerimiento (HU-18) y trasladarACartera (HU-19); el pago posterior al traslado
// usa POST /incapacidades/:id/pago con origen=cobro-juridico (HU-19.CA2). Para el rol Cartera y Jurídica: la lista
// de trasladadas (GET /cartera) y registrarDecision (HU-20), con una pantalla de decisión por incapacidad (DA-45).
// Diseño (DA-43): pantalla «Cobro persuasivo» con la línea de tiempo de los requerimientos y el formulario como último paso.
import { Router } from 'express';
import { ErrorDeValidacion } from '../controllers/error-de-validacion.js';
import { FUNDAMENTOS_MAXIMO, MOTIVO_MAXIMO } from '../controllers/cobro-juridico.controller.js';
import { permitir } from '../middleware/autenticacion.js';
import { NOMBRES_DECISION, NOMBRES_TIPO_INCAPACIDAD } from '../models/incapacidad.model.js';
import { fechaBreve, fechaLarga } from '../servicios/dias-habiles.js';

export function crearRutasCobroJuridico({ control }) {
  const rutas = Router();

  const pagina = (res, estado, datos = {}) =>
    res.status(estado).pagina('cobro-juridico/registrar-requerimiento', {
      titulo: 'Cobro persuasivo',
      errores: {},
      valores: {},
      registrado: false,
      trasladadoAhora: false,
      pagoRegistrado: false,
      fechaBreve,
      fechaLarga,
      nombresTipo: NOMBRES_TIPO_INCAPACIDAD,
      fundamentosMaximo: FUNDAMENTOS_MAXIMO,
      motivoMaximo: MOTIVO_MAXIMO,
      nombresDecision: NOMBRES_DECISION,
      ...datos,
    });

  const noExiste = (res) =>
    res.status(404).pagina('error', { titulo: 'Incapacidad no encontrada', mensaje: 'No hay una incapacidad con ese número.' });

  // Cobro persuasivo de una incapacidad. Tras registrar se vuelve con ?registrado=1; la confirmación solo aparece
  // si de verdad hay requerimientos (un enlace copiado no la muestra).
  rutas.get('/incapacidades/:id/requerimientos', permitir('registrarRequerimiento'), async (req, res) => {
    const cobro = await control.prepararRequerimientos(req.params.id);
    if (!cobro) return noExiste(res);
    await pagina(res, 200, {
      cobro,
      registrado: req.query.registrado === '1' && cobro.total > 0,
      trasladadoAhora: req.query.trasladado === '1' && cobro.trasladada,
      pagoRegistrado: req.query.pagado === '1' && cobro.incapacidad.estado === 'pagada',
    });
  });

  // registrarRequerimiento(fundamentos) — HU-18.CA1. Fundamentos no válidos: 400; sin demora o no pendiente: 409.
  rutas.post('/incapacidades/:id/requerimiento', permitir('registrarRequerimiento'), async (req, res) => {
    const fundamentos = String(req.body?.fundamentos ?? '');
    try {
      const resultado = await control.registrarRequerimiento(req.params.id, { fundamentos }, req.usuario);
      if (!resultado) return noExiste(res);
      res.redirect(303, `/incapacidades/${resultado.idIncapacidad}/requerimientos?registrado=1`);
    } catch (error) {
      if (!(error instanceof ErrorDeValidacion)) throw error;
      const cobro = await control.prepararRequerimientos(req.params.id);
      if (!cobro) return noExiste(res);
      await pagina(res, error.errores.estado ? 409 : 400, {
        cobro,
        errores: error.errores,
        valores: { fundamentos: fundamentos.slice(0, FUNDAMENTOS_MAXIMO + 1) },
      });
    }
  });

  // trasladarACartera(motivo) — HU-19.CA1. Motivo no válido: 400; sin demora, no pendiente o ya trasladada: 409.
  rutas.post('/incapacidades/:id/traslado', permitir('trasladarACartera'), async (req, res) => {
    const motivo = String(req.body?.motivo ?? '');
    try {
      const resultado = await control.trasladarACartera(req.params.id, { motivo });
      if (!resultado) return noExiste(res);
      res.redirect(303, `/incapacidades/${resultado.idIncapacidad}/requerimientos?trasladado=1`);
    } catch (error) {
      if (!(error instanceof ErrorDeValidacion)) throw error;
      const cobro = await control.prepararRequerimientos(req.params.id);
      if (!cobro) return noExiste(res);
      await pagina(res, error.errores.estado ? 409 : 400, {
        cobro,
        errores: error.errores,
        valores: { motivo: motivo.slice(0, MOTIVO_MAXIMO + 1) },
      });
    }
  });

  // Rol Cartera y Jurídica (HU-20): las trasladadas, con pestañas «Esperan decisión / Decididas». Solo consulta.
  rutas.get('/cartera', permitir('registrarDecision'), async (req, res) => {
    const datos = await control.consultarTrasladadas(String(req.query.ver ?? 'pendientes'));
    res.pagina('cobro-juridico/consultar-trasladadas', {
      titulo: 'Cobro jurídico',
      ...datos,
      fechaBreve,
      nombresTipo: NOMBRES_TIPO_INCAPACIDAD,
      nombresDecision: NOMBRES_DECISION,
    });
  });

  const paginaDecision = (res, estado, datos = {}) =>
    res.status(estado).pagina('cobro-juridico/registrar-decision', {
      titulo: 'Decisión de Cartera y Jurídica',
      errores: {},
      registrada: false,
      fechaBreve,
      fechaLarga,
      nombresTipo: NOMBRES_TIPO_INCAPACIDAD,
      nombresDecision: NOMBRES_DECISION,
      ...datos,
    });

  // Pantalla de decisión de una incapacidad. Tras registrar se vuelve con ?registrada=1; la confirmación solo
  // aparece si de verdad hay decisión (un enlace copiado no la muestra).
  rutas.get('/incapacidades/:id/decision', permitir('registrarDecision'), async (req, res) => {
    const decision = await control.prepararDecision(req.params.id);
    if (!decision) return noExiste(res);
    await paginaDecision(res, 200, { decision, registrada: req.query.registrada === '1' && decision.incapacidad.decision != null });
  });

  // registrarDecision(decision) — HU-20.CA1. Decisión no válida: 400; sin traslado, ya decidida o no cobrada: 409.
  rutas.post('/incapacidades/:id/decision', permitir('registrarDecision'), async (req, res) => {
    try {
      const resultado = await control.registrarDecision(req.params.id, { decision: String(req.body?.decision ?? '') });
      if (!resultado) return noExiste(res);
      res.redirect(303, `/incapacidades/${resultado.idIncapacidad}/decision?registrada=1`);
    } catch (error) {
      if (!(error instanceof ErrorDeValidacion)) throw error;
      const decision = await control.prepararDecision(req.params.id);
      if (!decision) return noExiste(res);
      await paginaDecision(res, error.errores.estado ? 409 : 400, { decision, errores: error.errores });
    }
  });

  return rutas;
}
