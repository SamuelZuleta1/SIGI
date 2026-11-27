// Grupo `estadisticas` de la Interfaz de incapacidades — panel de estadísticas e informes de gestión (solo el auxiliar,
// DA-02). Todo es de consulta (GET): GET /estadisticas (panel con rango y entidad), GET /informes (elegir el informe) y
// GET /informes/generar (el informe en pantalla, listo para imprimir o guardar en PDF, o descargado en CSV).
import { Router } from 'express';
import {
  TRAMOS_CARTERA,
  aCsv,
  decimal,
  filasCsv,
  nombreArchivo,
  nombreMes,
  nombreMesLargo,
  nombreRango,
  numero,
  pesosCortos,
  porcentaje,
} from '../controllers/estadisticas.controller.js';
import { ErrorDeValidacion } from '../controllers/error-de-validacion.js';
import { permitir } from '../middleware/autenticacion.js';
import { NOMBRES_ESTADO_INCAPACIDAD, NOMBRES_TIPO_INCAPACIDAD } from '../models/incapacidad.model.js';
import { diasCalendario, fechaBreve } from '../servicios/dias-habiles.js';
import { anchoRelativo, columnas } from '../servicios/graficas.js';
import { aCentavos, pesos } from '../servicios/moneda.js';

// Lo que usan las vistas para dar formato y dibujar.
const AYUDAS = {
  numero,
  decimal,
  porcentaje,
  // Con espacio de no separación: «$ 11.626.000» no se parte en dos líneas.
  pesos: (centavos) => pesos(centavos / 100).replace(/\s/g, '\u00a0'),
  pesosCortos,
  nombreMes,
  nombreMesLargo,
  nombreRango,
  fechaBreve,
  diasCalendario,
  aCentavos,
  columnas,
  anchoRelativo,
  TRAMOS_CARTERA,
  NOMBRES_ESTADO_INCAPACIDAD,
  NOMBRES_TIPO_INCAPACIDAD,
};

/** Enlace con los filtros (solo los que tienen valor). */
export function enlaceCon(ruta, filtros) {
  const parametros = new URLSearchParams();
  for (const [clave, valor] of Object.entries(filtros)) if (valor) parametros.set(clave, valor);
  const texto = parametros.toString();
  return texto ? `${ruta}?${texto}` : ruta;
}

export function crearRutasEstadisticas({ control }) {
  const rutas = Router();

  rutas.get('/estadisticas', permitir('consultarEstadisticas'), async (req, res) => {
    const datos = await control.consultarEstadisticas(req.query);
    res.status(datos.estadisticas ? 200 : 400).pagina('estadisticas/panel', {
      titulo: 'Estadísticas',
      ...AYUDAS,
      ...datos,
      enlaceCon,
    });
  });

  const formulario = async (res, estado, consulta, errores = {}) => {
    const datos = await control.prepararInformes(consulta);
    return res.status(estado).pagina('estadisticas/informes', { titulo: 'Informes', ...datos, errores, enlaceCon });
  };

  rutas.get('/informes', permitir('generarInforme'), async (req, res) => {
    await formulario(res, 200, req.query);
  });

  rutas.get('/informes/generar', permitir('generarInforme'), async (req, res) => {
    let informe;
    try {
      informe = await control.generarInforme(req.query, req.usuario);
    } catch (error) {
      if (!(error instanceof ErrorDeValidacion)) throw error;
      return formulario(res, 400, req.query, error.errores);
    }
    // Los datos son de colaboradores: el navegador y los proxies no deben guardar copia.
    res.set('Cache-Control', 'no-store');
    if (informe.formato === 'csv') {
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="${nombreArchivo(informe)}"`);
      return res.send(aCsv(filasCsv(informe)));
    }
    const filtros = {
      tipo: informe.tipo.clave,
      desde: informe.tipo.usaRango ? informe.estadisticas.rango.desde : '',
      hasta: informe.tipo.usaRango ? informe.estadisticas.rango.hasta : '',
      entidad: informe.entidad ? String(informe.entidad.id) : '',
    };
    res.pagina('estadisticas/informe', {
      titulo: `${informe.titulo}${informe.tipo.usaRango ? ` · ${nombreRango(informe.estadisticas.rango)}` : ''}`,
      ...AYUDAS,
      informe,
      e: informe.estadisticas,
      enlaceCsv: enlaceCon('/informes/generar', { ...filtros, formato: 'csv' }),
      enlaceVolver: enlaceCon('/informes', filtros),
    });
  });

  return rutas;
}
