// Grupo `cobro-juridico` de la Interfaz de incapacidades — DS-08 (CU-12).
// Operaciones de la Vista: registrarRequerimiento (HU-18) y trasladarACartera (HU-19); el pago posterior al traslado
// usa POST /incapacidades/:id/pago con origen=cobro-juridico (HU-19.CA2). Para el rol Cartera y Jurídica: la lista
// de trasladadas (GET /cartera) y registrarDecision (HU-20), con una pantalla de decisión por incapacidad (DA-45).
// Diseño (DA-43): pantalla «Cobro persuasivo» con la línea de tiempo de los requerimientos y el formulario como último paso.
import { Router } from 'express';
import { ErrorDeAviso } from '../controllers/error-de-aviso.js';
import { ErrorDeValidacion } from '../controllers/error-de-validacion.js';
import { responderAvisoFallido } from './aviso-fallido.js';
import { FUNDAMENTOS_MAXIMO, MOTIVO_MAXIMO, NOMBRES_CAUSAL } from '../controllers/cobro-juridico.controller.js';
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
      nombresCausal: NOMBRES_CAUSAL,
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

  // trasladarACartera(causal, motivo) — HU-19.CA1 (auditoría, decisión 4A). Causal o motivo no válidos: 400; faltan
  // requerimientos, la causal no se cumple, no está en cobro persuasivo o ya se trasladó: 409.
  rutas.post('/incapacidades/:id/traslado', permitir('trasladarACartera'), async (req, res) => {
    const motivo = String(req.body?.motivo ?? '');
    const causal = String(req.body?.causal ?? '');
    try {
      const resultado = await control.trasladarACartera(req.params.id, { causal, motivo });
      if (!resultado) return noExiste(res);
      res.redirect(303, `/incapacidades/${resultado.idIncapacidad}/requerimientos?trasladado=1`);
    } catch (error) {
      const volverAlFormulario = async (estado, errores) => {
        const cobro = await control.prepararRequerimientos(req.params.id);
        if (!cobro) return noExiste(res);
        await pagina(res, estado, { cobro, errores, valores: { causal: causal.slice(0, 20), motivo: motivo.slice(0, MOTIVO_MAXIMO + 1) } });
      };
      // El correo a Cartera y Jurídica falló: 502 si se deshizo el traslado, 500 si no (ver aviso-fallido.js).
      if (error instanceof ErrorDeAviso) return responderAvisoFallido(res, error, { destinatario: 'a Cartera y Jurídica', volverAlFormulario });
      if (!(error instanceof ErrorDeValidacion)) throw error;
      const conflicto = error.errores.estado || error.errores.requerimientos || (error.errores.causal && causal !== '' && Object.hasOwn(NOMBRES_CAUSAL, causal));
      await volverAlFormulario(conflicto ? 409 : 400, error.errores);
    }
  });

  // Rol Cartera y Jurídica (HU-20): las trasladadas, con pestañas «Esperan decisión / Decididas». Solo consulta.
  rutas.get('/cartera', permitir('registrarDecision'), async (req, res) => {
    const datos = await control.consultarTrasladadas(String(req.query.ver ?? 'pendientes'));
    res.pagina('cobro-juridico/consultar-trasladadas', {
      titulo: 'Cobro jurídico',
      nombresCausal: NOMBRES_CAUSAL,
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
      nombresCausal: NOMBRES_CAUSAL,
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
