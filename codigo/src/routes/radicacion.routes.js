// Grupo `radicacion` de la Interfaz de incapacidades — DS-04 (CU-06).
// Operaciones de la Vista: prepararRadicacion (HU-09). registrarRadicacion llega con HU-10.
import { Router } from 'express';
import { permitir } from '../middleware/autenticacion.js';
import { NOMBRES_TIPO_INCAPACIDAD } from '../models/incapacidad.model.js';
import { fechaBreve, fechaLarga } from '../servicios/dias-habiles.js';

export function crearRutasRadicacion({ control }) {
  const rutas = Router();

  const pagina = (res, estado, datos = {}) =>
    res.status(estado).pagina('radicacion/preparar-radicacion', {
      titulo: 'Preparar radicación',
      radicacion: null,
      numero: '',
      errorNumero: null,
      fechaLarga,
      fechaBreve,
      nombresTipo: NOMBRES_TIPO_INCAPACIDAD,
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

  // prepararRadicacion → datosRadicacion (HU-09.CA1). Plazo por vencer o vencido: se advierte y se
  // responde 200, sin bloquear (HU-09.CA2, DA-14).
  rutas.get('/incapacidades/:id/radicacion', permitir('prepararRadicacion'), async (req, res) => {
    const radicacion = await control.prepararRadicacion(req.params.id);
    if (!radicacion) {
      return pagina(res, 404, { numero: String(req.params.id).slice(0, 20), errorNumero: 'No hay una incapacidad con ese número.' });
    }
    await pagina(res, 200, { radicacion });
  });

  return rutas;
}
