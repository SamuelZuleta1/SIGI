// Grupo `reconocimiento` de la Interfaz de incapacidades — DS-09 (CU-13).
// Operación de la Vista: calcularReconocimiento (HU-21), con la lista de incapacidades (GET /reconocimiento) y
// una pantalla de cálculo por incapacidad (DA-46). Sin JavaScript: el formulario es un POST normal.
import { Router } from 'express';
import { ErrorDeValidacion } from '../controllers/error-de-validacion.js';
import { permitir } from '../middleware/autenticacion.js';
import { NOMBRES_TIPO_INCAPACIDAD } from '../models/incapacidad.model.js';
import { fechaBreve, fechaEnColombia } from '../servicios/dias-habiles.js';
import { pesos } from '../servicios/moneda.js';

export function crearRutasReconocimiento({ control }) {
  const rutas = Router();

  const pagina = (res, estado, datos) =>
    res.status(estado).pagina('reconocimiento/calcular-reconocimiento', {
      titulo: 'Reconocimiento económico',
      errores: {},
      valores: {},
      calculado: false,
      fechaBreve,
      fechaEnColombia,
      pesos,
      nombresTipo: NOMBRES_TIPO_INCAPACIDAD,
      ...datos,
    });

  const noExiste = (res) =>
    res.status(404).pagina('error', { titulo: 'Incapacidad no encontrada', mensaje: 'No hay una incapacidad con ese número.' });

  rutas.get('/reconocimiento', permitir('calcularReconocimiento'), async (req, res) => {
    const datos = await control.consultarReconocimientos();
    res.pagina('reconocimiento/consultar-reconocimientos', {
      titulo: 'Reconocimiento económico',
      ...datos,
      pesos,
      nombresTipo: NOMBRES_TIPO_INCAPACIDAD,
    });
  });

  // Tras calcular se vuelve con ?calculado=1; la confirmación solo aparece si de verdad hay un cálculo.
  rutas.get('/incapacidades/:id/reconocimiento', permitir('calcularReconocimiento'), async (req, res) => {
    const reconocimiento = await control.prepararReconocimiento(req.params.id);
    if (!reconocimiento) return noExiste(res);
    await pagina(res, 200, { reconocimiento, calculado: req.query.calculado === '1' && reconocimiento.resultado != null });
  });

  // calcularReconocimiento(ibc) — HU-21. IBC no válido: 400.
  rutas.post('/incapacidades/:id/reconocimiento', permitir('calcularReconocimiento'), async (req, res) => {
    const ibc = String(req.body?.ibc ?? '');
    try {
      const resultado = await control.calcularReconocimiento(req.params.id, { ibc }, req.usuario);
      if (!resultado) return noExiste(res);
      res.redirect(303, `/incapacidades/${resultado.idIncapacidad}/reconocimiento?calculado=1`);
    } catch (error) {
      if (!(error instanceof ErrorDeValidacion)) throw error;
      const reconocimiento = await control.prepararReconocimiento(req.params.id);
      if (!reconocimiento) return noExiste(res);
      await pagina(res, 400, { reconocimiento, errores: error.errores, valores: { ibc: ibc.slice(0, 40) } });
    }
  });

  return rutas;
}
