// Grupo `cobro-juridico` de la Interfaz de incapacidades — DS-08 (CU-12).
// Operaciones de la Vista: registrarRequerimiento (HU-18). El traslado a Cartera (HU-19) y la decisión (HU-20) se
// agregan a este grupo.
// Diseño (DA-43): pantalla «Cobro persuasivo» con la línea de tiempo de los requerimientos y el formulario como último paso.
import { Router } from 'express';
import { ErrorDeValidacion } from '../controllers/error-de-validacion.js';
import { FUNDAMENTOS_MAXIMO } from '../controllers/cobro-juridico.controller.js';
import { permitir } from '../middleware/autenticacion.js';
import { NOMBRES_TIPO_INCAPACIDAD } from '../models/incapacidad.model.js';
import { fechaBreve, fechaLarga } from '../servicios/dias-habiles.js';

export function crearRutasCobroJuridico({ control }) {
  const rutas = Router();

  const pagina = (res, estado, datos = {}) =>
    res.status(estado).pagina('cobro-juridico/registrar-requerimiento', {
      titulo: 'Cobro persuasivo',
      errores: {},
      valores: {},
      registrado: false,
      fechaBreve,
      fechaLarga,
      nombresTipo: NOMBRES_TIPO_INCAPACIDAD,
      fundamentosMaximo: FUNDAMENTOS_MAXIMO,
      ...datos,
    });

  const noExiste = (res) =>
    res.status(404).pagina('error', { titulo: 'Incapacidad no encontrada', mensaje: 'No hay una incapacidad con ese número.' });

  // Cobro persuasivo de una incapacidad. Tras registrar se vuelve con ?registrado=1; la confirmación solo aparece
  // si de verdad hay requerimientos (un enlace copiado no la muestra).
  rutas.get('/incapacidades/:id/requerimientos', permitir('registrarRequerimiento'), async (req, res) => {
    const cobro = await control.prepararRequerimientos(req.params.id);
    if (!cobro) return noExiste(res);
    await pagina(res, 200, { cobro, registrado: req.query.registrado === '1' && cobro.total > 0 });
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

  return rutas;
}
