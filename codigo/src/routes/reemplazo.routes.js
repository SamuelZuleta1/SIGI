// Grupo `reemplazo` de la Interfaz de incapacidades — DS-02 (CU-03).
// Operación de la Vista: registrarReemplazo.
import { Router } from 'express';
import { ErrorDeValidacion } from '../controllers/error-de-validacion.js';
import { permitir } from '../middleware/autenticacion.js';

const SIN_INCAPACIDAD = 'No hay una incapacidad con ese número.';

export function crearRutasReemplazo({ control }) {
  const rutas = Router();

  const pagina = (res, estado, datos = {}) =>
    res.status(estado).pagina('reemplazo/registrar-reemplazo', {
      titulo: 'Registrar reemplazo',
      incapacidad: null,
      numero: '',
      errorNumero: null,
      actual: null,
      valor: null,
      error: null,
      registrado: false,
      ...datos,
    });

  const noExiste = (res, numero) => pagina(res, 404, { numero: String(numero).slice(0, 20), errorNumero: SIN_INCAPACIDAD });

  // Entrada del menú: pide el número de la incapacidad y lleva a su formulario.
  rutas.get('/reemplazo', permitir('registrarReemplazo'), async (req, res) => {
    const numero = String(req.query.incapacidad ?? '').trim().slice(0, 20);
    if (!numero) return pagina(res, 200);
    const encontrada = await control.obtenerReemplazo(numero);
    if (!encontrada) return noExiste(res, numero);
    res.redirect(303, `/incapacidades/${encontrada.incapacidad.idIncapacidad}/reemplazo`);
  });

  // Formulario. Si la incapacidad ya tiene reemplazo, el campo llega con ese nombre (DA-22).
  // Tras registrar, se vuelve aquí con ?registrado=1 para mostrar la confirmación.
  rutas.get('/incapacidades/:id/reemplazo', permitir('registrarReemplazo'), async (req, res) => {
    const encontrada = await control.obtenerReemplazo(req.params.id);
    if (!encontrada) return noExiste(res, req.params.id);
    const { incapacidad, reemplazo: actual } = encontrada;
    await pagina(res, 200, { incapacidad, actual, registrado: req.query.registrado === '1' && actual !== null });
  });

  rutas.post('/incapacidades/:id/reemplazo', permitir('registrarReemplazo'), async (req, res) => {
    try {
      const { idIncapacidad } = await control.registrarReemplazo(req.params.id, req.body?.reemplazo, req.usuario);
      res.redirect(303, `/incapacidades/${idIncapacidad}/reemplazo?registrado=1`);
    } catch (error) {
      if (!(error instanceof ErrorDeValidacion)) throw error;
      const encontrada = await control.obtenerReemplazo(req.params.id);
      if (!encontrada) return noExiste(res, req.params.id);
      await pagina(res, 400, {
        incapacidad: encontrada.incapacidad,
        actual: encontrada.reemplazo,
        valor: String(req.body?.reemplazo ?? '').slice(0, 200),
        error: error.errores.reemplazo,
      });
    }
  });

  return rutas;
}
