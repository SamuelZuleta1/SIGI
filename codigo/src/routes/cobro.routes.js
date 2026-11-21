// Grupo `cobro` de la Interfaz de incapacidades — DS-06 (CU-10).
// Operaciones de la Vista: registrarCobrada (HU-13). Diseño: opción B «línea de tiempo del cobro» (DA-38).
import { Router } from 'express';
import { TIEMPO_PAGO_MAXIMO, TIEMPO_PAGO_MINIMO, TIEMPOS_FRECUENTES } from '../controllers/cobro.controller.js';
import { ErrorDeValidacion } from '../controllers/error-de-validacion.js';
import { permitir } from '../middleware/autenticacion.js';
import { NOMBRES_ESTADO_INCAPACIDAD, NOMBRES_TIPO_INCAPACIDAD } from '../models/incapacidad.model.js';
import { fechaBreve, fechaEnColombia, fechaLarga } from '../servicios/dias-habiles.js';

export function crearRutasCobro({ control }) {
  const rutas = Router();

  const pagina = (res, estado, datos = {}) =>
    res.status(estado).pagina('cobro/registrar-cobro', {
      titulo: 'Cobro',
      cobro: null,
      numero: '',
      errorNumero: null,
      errores: {},
      valores: {},
      registrada: false,
      tiempoMinimo: TIEMPO_PAGO_MINIMO,
      tiempoMaximo: TIEMPO_PAGO_MAXIMO,
      tiemposFrecuentes: TIEMPOS_FRECUENTES,
      fechaLarga,
      fechaBreve,
      fechaEnColombia,
      nombresTipo: NOMBRES_TIPO_INCAPACIDAD,
      nombresEstado: NOMBRES_ESTADO_INCAPACIDAD,
      ...datos,
    });

  const noExiste = (res, numero) =>
    pagina(res, 404, { numero: String(numero ?? '').slice(0, 20), errorNumero: 'No hay una incapacidad con ese número.' });

  // Entrada del menú: pide el número de la incapacidad y lleva a su cobro.
  rutas.get('/cobro', permitir('registrarCobrada'), async (req, res) => {
    const numero = String(req.query.incapacidad ?? '').trim().slice(0, 20);
    if (!numero) return pagina(res, 200);
    const cobro = await control.prepararCobro(numero);
    if (!cobro) return noExiste(res, numero);
    res.redirect(303, `/incapacidades/${cobro.incapacidad.idIncapacidad}/cobro`);
  });

  // Línea de tiempo del cobro. Tras registrar, se vuelve con ?registrada=1 (HU-13.CA1: confirmación).
  // La confirmación solo se muestra si de verdad quedó cobrada (un enlace copiado no debe fallar).
  rutas.get('/incapacidades/:id/cobro', permitir('registrarCobrada'), async (req, res) => {
    const cobro = await control.prepararCobro(req.params.id);
    if (!cobro) return noExiste(res, req.params.id);
    await pagina(res, 200, { cobro, registrada: req.query.registrada === '1' && cobro.fechaPrometida != null });
  });

  // registrarCobrada(idIncapacidad, tiempoPago) — HU-13. Dato no válido: 400; el estado no es transcrita: 409.
  rutas.post('/incapacidades/:id/cobro', permitir('registrarCobrada'), async (req, res) => {
    const tiempoPago = String(req.body?.tiempoPago ?? '');
    try {
      const resultado = await control.registrarCobrada(req.params.id, { tiempoPago });
      if (!resultado) return noExiste(res, req.params.id);
      res.redirect(303, `/incapacidades/${resultado.idIncapacidad}/cobro?registrada=1`);
    } catch (error) {
      if (!(error instanceof ErrorDeValidacion)) throw error;
      const cobro = await control.prepararCobro(req.params.id);
      if (!cobro) return noExiste(res, req.params.id);
      const estado = error.errores.estado ? 409 : 400;
      await pagina(res, estado, { cobro, errores: error.errores, valores: { tiempoPago: tiempoPago.slice(0, 10) } });
    }
  });

  return rutas;
}
