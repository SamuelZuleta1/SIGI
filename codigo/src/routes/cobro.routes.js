// Grupo `cobro` de la Interfaz de incapacidades — DS-06 (CU-10).
// Operaciones de la Vista: registrarCobrada (HU-13), registrarRechazo (HU-14) y registrarPago (HU-15).
// Diseño: opción B «línea de tiempo del cobro» (DA-38); la respuesta de la entidad, segmento «Aprobó / Rechazó» (DA-39);
// el pago, último paso de la misma línea de tiempo (DA-40). Auditoría (HU-15, decisión 3A): anularPago desde el mismo
// paso del pago, con un desplegable como «Registrar otro pago».
import { Router } from 'express';
import { MOTIVO_ANULACION_MAXIMO, MOTIVO_ANULACION_MINIMO } from '../controllers/anulacion.js';
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
import { pesos } from '../servicios/moneda.js';

// HU-15.CA2: el pago se registra con la misma operación desde el cobro, el seguimiento (HU-16) y el cobro
// jurídico (HU-19). `origen` (lista cerrada) solo decide a qué pantalla se vuelve tras registrarlo.
export const ORIGENES_PAGO = Object.freeze({
  cobro: (id) => `/incapacidades/${id}/cobro?pagado=1`,
  seguimiento: (id) => `/incapacidades/${id}/seguimiento?pagado=1`, // HU-16.CA2
  'cobro-juridico': (id) => `/incapacidades/${id}/requerimientos?pagado=1`, // HU-19.CA2
});
const leerOrigen = (valor) => (Object.hasOwn(ORIGENES_PAGO, valor) ? valor : 'cobro');

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
      pagoRegistrado: false,
      pagoAnulado: null,
      anulando: null,
      motivoMinimo: MOTIVO_ANULACION_MINIMO,
      motivoMaximo: MOTIVO_ANULACION_MAXIMO,
      origen: 'cobro',
      pesos,
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
      pagoRegistrado: req.query.pagado === '1' && cobro.incapacidad.estado === 'pagada' && cobro.incapacidad.pagos.length > 0,
      // Auditoría: confirmación de la anulación, solo si ese pago de verdad está anulado.
      pagoAnulado: cobro.incapacidad.pagos.find((p) => String(p.idPago) === String(req.query.anulado ?? '') && p.anulacion) ?? null,
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

  // registrarPago(idIncapacidad, valor, fechaPago) — HU-15 (DA-16). Datos no válidos: 400; el estado no es cobrada ni
  // pagada: 409. Si falla, se muestra en la línea de tiempo del cobro con lo escrito y el origen, para volver a él.
  rutas.post('/incapacidades/:id/pago', permitir('registrarPago'), async (req, res) => {
    const valor = String(req.body?.valor ?? '');
    const fechaPago = String(req.body?.fechaPago ?? '');
    const origen = leerOrigen(String(req.body?.origen ?? ''));
    try {
      const resultado = await control.registrarPago(req.params.id, { valor, fechaPago }, req.usuario);
      if (!resultado) return noExiste(res, req.params.id);
      res.redirect(303, ORIGENES_PAGO[origen](resultado.idIncapacidad));
    } catch (error) {
      if (!(error instanceof ErrorDeValidacion)) throw error;
      const cobro = await control.prepararCobro(req.params.id);
      if (!cobro) return noExiste(res, req.params.id);
      const estado = error.errores.estado ? 409 : 400;
      await pagina(res, estado, {
        cobro,
        origen,
        errores: error.errores,
        valores: { valor: valor.trim().slice(0, 30), fechaPago: fechaPago.trim().slice(0, 10) },
      });
    }
  });

  // Auditoría (HU-15): anularPago(idIncapacidad, idPago, motivo). Motivo no válido: 400; el pago ya no se puede anular
  // (anulado, conciliado o archivo preparado): 409. Si falla, el desplegable de ese pago vuelve abierto con lo escrito.
  rutas.post('/incapacidades/:id/pagos/:idPago/anulacion', permitir('anularPago'), async (req, res) => {
    const motivo = String(req.body?.motivo ?? '');
    try {
      const resultado = await control.anularPago(req.params.id, req.params.idPago, { motivo }, req.usuario);
      if (!resultado) return noExiste(res, req.params.id);
      res.redirect(303, `/incapacidades/${resultado.idIncapacidad}/cobro?anulado=${resultado.idPago}`);
    } catch (error) {
      if (!(error instanceof ErrorDeValidacion)) throw error;
      const cobro = await control.prepararCobro(req.params.id);
      if (!cobro) return noExiste(res, req.params.id);
      await pagina(res, error.errores.anulacion ? 409 : 400, {
        cobro,
        anulando: Number(req.params.idPago) || null,
        errores: error.errores,
        valores: { motivo: motivo.trim().slice(0, MOTIVO_ANULACION_MAXIMO * 2) },
      });
    }
  });

  return rutas;
}
