// Grupo `estados` de la Interfaz de incapacidades — DS-05 (CU-08).
// Operación de la Vista: consultarEstados(filtros) → mostrarEstados (HU-11). Solo lectura (GET).
import { Router } from 'express';
import { ErrorDeValidacion } from '../controllers/error-de-validacion.js';
import { FILTROS_DE_ESTADO, LARGO_MAXIMO_COLABORADOR, LIMITE_RESULTADOS, leerFiltros } from '../controllers/estados.controller.js';
import { permitir } from '../middleware/autenticacion.js';
import { NOMBRES_ESTADO_INCAPACIDAD, NOMBRES_TIPO_INCAPACIDAD } from '../models/incapacidad.model.js';
import { fechaBreve } from '../servicios/dias-habiles.js';

/** URL de la consulta con estos filtros (sin los vacíos), para las pestañas de estado. */
export function enlaceConsulta(filtros) {
  const parametros = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v));
  const texto = parametros.toString();
  return texto ? `/estados?${texto}` : '/estados';
}

export function crearRutasEstados({ control }) {
  const rutas = Router();

  // consultarEstados(filtros) → obtenerEstados → listaEstados → mostrarEstados (HU-11.CA1, DA-20).
  // Filtros no válidos: 400 con el mensaje en su campo y sin lista.
  rutas.get('/estados', permitir('consultarEstados'), async (req, res) => {
    const entidades = await control.consultarEntidadesDeFiltro();
    let datos;
    let errores = {};
    let estado = 200;
    try {
      datos = await control.obtenerEstados(req.query);
    } catch (error) {
      if (!(error instanceof ErrorDeValidacion)) throw error;
      errores = error.errores;
      estado = 400;
      const filtros = leerFiltros(req.query);
      filtros.colaborador = filtros.colaborador.slice(0, LARGO_MAXIMO_COLABORADOR);
      datos = { filtros, incapacidades: [], total: 0, conteos: null, limitado: false };
    }
    res.status(estado).pagina('estados/consultar-estados', {
      titulo: 'Consultar estados',
      ...datos,
      errores,
      entidades,
      estadosDeFiltro: FILTROS_DE_ESTADO,
      limite: LIMITE_RESULTADOS,
      largoColaborador: LARGO_MAXIMO_COLABORADOR,
      enlaceConsulta,
      nombresTipo: NOMBRES_TIPO_INCAPACIDAD,
      nombresEstado: NOMBRES_ESTADO_INCAPACIDAD,
      fechaBreve,
    });
  });

  return rutas;
}
