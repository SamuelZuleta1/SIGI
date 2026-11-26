// Grupo `reconocimiento` de la Interfaz de incapacidades — DS-09 (CU-13).
// Operación de la Vista: calcularReconocimiento (HU-21), con la lista de incapacidades (GET /reconocimiento) y
// una pantalla de cálculo por incapacidad (DA-46). Sin JavaScript: el formulario es un POST normal.
// Con JavaScript, la lista calcula en la propia fila: el mismo POST (con `Accept: application/json`) responde con los
// valores y el detalle por tramos, y GET .../detalle da ese detalle para lo ya calculado.
import { Router } from 'express';
import { ErrorDeValidacion } from '../controllers/error-de-validacion.js';
import { permitir } from '../middleware/autenticacion.js';
import { NOMBRES_TIPO_INCAPACIDAD } from '../models/incapacidad.model.js';
import { fechaBreve, fechaEnColombia } from '../servicios/dias-habiles.js';
import { pesos } from '../servicios/moneda.js';

const quiereJson = (req) => (req.get('Accept') ?? '').includes('application/json');

/** Advertencia del IBC fuera de lo habitual (DA-50): un texto junto al dato. */
export const textoAdvertenciaIbc = (advertencia) =>
  advertencia.tipo === 'bajo'
    ? `IBC por debajo de 1 SMMLV de ${advertencia.anio} (${pesos(advertencia.limite)}). Revise el valor: se calculó igual.`
    : `IBC por encima de 25 SMMLV de ${advertencia.anio} (${pesos(advertencia.limite)}, tope de cotización). Revise el valor: se calculó igual.`;

export function crearRutasReconocimiento({ control }) {
  const rutas = Router();

  // El detalle por tramos de una incapacidad, como fragmento de HTML (el mismo de la pantalla de cálculo).
  const detalleHtml = (res, reconocimiento, calculado, idIncapacidad) =>
    new Promise((resolver, rechazar) =>
      res.render(
        'reconocimiento/_resultado',
        { reconocimiento, calculado, idTitulo: `titulo-resultado-${idIncapacidad}`, fechaBreve, fechaEnColombia, pesos },
        (error, html) => (error ? rechazar(error) : resolver(html)),
      ),
    );

  const pagina = (res, estado, datos) =>
    res.status(estado).pagina('reconocimiento/calcular-reconocimiento', {
      titulo: 'Reconocimiento económico',
      errores: {},
      valores: {},
      calculado: false,
      fechaBreve,
      fechaEnColombia,
      pesos,
      textoAdvertenciaIbc,
      nombresTipo: NOMBRES_TIPO_INCAPACIDAD,
      ...datos,
    });

  const noExiste = (res) =>
    res.status(404).pagina('error', { titulo: 'Incapacidad no encontrada', mensaje: 'No hay una incapacidad con ese número.' });

  rutas.get('/reconocimiento', permitir('calcularReconocimiento'), async (req, res) => {
    const q = Array.isArray(req.query.q) ? req.query.q[0] : req.query.q;
    const datos = await control.consultarReconocimientos(typeof q === 'string' ? q : '');
    res.pagina('reconocimiento/consultar-reconocimientos', {
      titulo: 'Reconocimiento económico',
      ...datos,
      pesos,
      nombresTipo: NOMBRES_TIPO_INCAPACIDAD,
    });
  });

  // Detalle por tramos de lo ya calculado, para abrirlo en la lista sin salir de ella. 404 si no hay cálculo.
  rutas.get('/incapacidades/:id/reconocimiento/detalle', permitir('calcularReconocimiento'), async (req, res) => {
    const reconocimiento = await control.prepararReconocimiento(req.params.id);
    if (!reconocimiento?.resultado) return res.status(404).type('text/plain').send('Sin cálculo');
    const html = await detalleHtml(res, reconocimiento, false, reconocimiento.incapacidad.idIncapacidad);
    res.set('Cache-Control', 'no-store').type('html').send(html);
  });

  // Tras calcular se vuelve con ?calculado=1; la confirmación solo aparece si de verdad hay un cálculo.
  rutas.get('/incapacidades/:id/reconocimiento', permitir('calcularReconocimiento'), async (req, res) => {
    const reconocimiento = await control.prepararReconocimiento(req.params.id);
    if (!reconocimiento) return noExiste(res);
    await pagina(res, 200, { reconocimiento, calculado: req.query.calculado === '1' && reconocimiento.resultado != null });
  });

  // calcularReconocimiento(ibc) — HU-21. IBC no válido: 400; incapacidad pagada: 409 (DA-53).
  rutas.post('/incapacidades/:id/reconocimiento', permitir('calcularReconocimiento'), async (req, res) => {
    const ibc = String(req.body?.ibc ?? '');
    const json = quiereJson(req);
    try {
      const resultado = await control.calcularReconocimiento(req.params.id, { ibc }, req.usuario);
      if (!resultado) {
        return json ? res.status(404).json({ errores: { estado: 'No hay una incapacidad con ese número.' } }) : noExiste(res);
      }
      if (!json) return res.redirect(303, `/incapacidades/${resultado.idIncapacidad}/reconocimiento?calculado=1`);
      // Calcular en la fila: los valores para las columnas, el aviso del IBC y el detalle por tramos.
      const reconocimiento = await control.prepararReconocimiento(resultado.idIncapacidad);
      const calculo = reconocimiento.resultado;
      return res.set('Cache-Control', 'no-store').json({
        idIncapacidad: resultado.idIncapacidad,
        ibc: pesos(calculo.ibc).replace(/^\$\s?/, ''),
        empresa: pesos(calculo.valorEmpresa / 100),
        entidad: pesos(calculo.valorEPS / 100),
        tramitePension: Boolean(calculo.tramitePension),
        advertencia: reconocimiento.advertenciaIbc ? textoAdvertenciaIbc(reconocimiento.advertenciaIbc) : null,
        detalle: await detalleHtml(res, reconocimiento, true, resultado.idIncapacidad),
      });
    } catch (error) {
      if (!(error instanceof ErrorDeValidacion)) throw error;
      if (json) return res.status(error.errores.estado ? 409 : 400).json({ errores: error.errores });
      const reconocimiento = await control.prepararReconocimiento(req.params.id);
      if (!reconocimiento) return noExiste(res);
      await pagina(res, error.errores.estado ? 409 : 400, { reconocimiento, errores: error.errores, valores: { ibc: ibc.slice(0, 40) } });
    }
  });

  return rutas;
}
