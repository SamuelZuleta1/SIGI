// Grupo `cobro` de la Interfaz de incapacidades — DS-06 (CU-10).
// Operaciones de la Vista: registrarCobrada (HU-13) y registrarRechazo (HU-14).
// Diseño: opción B «línea de tiempo del cobro» (DA-38); la respuesta de la entidad, segmento «Aprobó / Rechazó» (DA-39).
import { Router } from 'express';
import {
  CAUSAL_MAXIMO,
  CAUSAL_MINIMO,
  TIEMPO_PAGO_MAXIMO,
  TIEMPO_PAGO_MINIMO,
  TIEMPOS_FRECUENTES,
} from '../controllers/cobro.controller.js';
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
      rechazoRegistrado: false,
      respuesta: 'aprobo',
      causalMinimo: CAUSAL_MINIMO,
      causalMaximo: CAUSAL_MAXIMO,
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

  // Línea de tiempo del cobro. Tras registrar, se vuelve con ?registrada=1 (HU-13.CA1) o ?rechazada=1
  // (HU-14.CA1: mostrarCausal). La confirmación solo se muestra si de verdad quedó en ese estado (un enlace
  // copiado no debe fallar). ?respuesta=rechazo abre el formulario del rechazo sin JavaScript (DA-39).
  rutas.get('/incapacidades/:id/cobro', permitir('registrarCobrada'), async (req, res) => {
    const cobro = await control.prepararCobro(req.params.id);
    if (!cobro) return noExiste(res, req.params.id);
    await pagina(res, 200, {
      cobro,
      respuesta: req.query.respuesta === 'rechazo' ? 'rechazo' : 'aprobo',
      registrada: req.query.registrada === '1' && cobro.fechaPrometida != null,
      rechazoRegistrado: req.query.rechazada === '1' && cobro.incapacidad.estado === 'rechazada',
    });
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

  // registrarRechazo(idIncapacidad, causal) — HU-14. Causal no válida: 400; el estado no es transcrita: 409.
  rutas.post('/incapacidades/:id/rechazo', permitir('registrarRechazo'), async (req, res) => {
    const causal = String(req.body?.causal ?? '');
    try {
      const resultado = await control.registrarRechazo(req.params.id, { causal });
      if (!resultado) return noExiste(res, req.params.id);
      res.redirect(303, `/incapacidades/${resultado.idIncapacidad}/cobro?rechazada=1`);
    } catch (error) {
      if (!(error instanceof ErrorDeValidacion)) throw error;
      const cobro = await control.prepararCobro(req.params.id);
      if (!cobro) return noExiste(res, req.params.id);
      const estado = error.errores.estado ? 409 : 400;
      await pagina(res, estado, {
        cobro,
        respuesta: 'rechazo',
        errores: error.errores,
        valores: { causal: causal.trim().slice(0, CAUSAL_MAXIMO * 2) },
      });
    }
  });

  return rutas;
}
