// Grupo `reportes` de la Interfaz de incapacidades — DS-12 (CU-16).
// Operación de la Vista: generarReporte(tipo, periodo), solo el auxiliar (DA-02). HU-27: GET /reportes (elegir el
// mes y los reportes recientes), POST /reportes/ausentismo y GET /reportes/:id (el reporte guardado, DA-57).
import { Router } from 'express';
import { diasPorTipo, totalesDelReporte } from '../controllers/reportes.controller.js';
import { ErrorDeAviso } from '../controllers/error-de-aviso.js';
import { ErrorDeValidacion } from '../controllers/error-de-validacion.js';
import { permitir } from '../middleware/autenticacion.js';
import { NOMBRES_ESTADO_INCAPACIDAD, NOMBRES_TIPO_INCAPACIDAD } from '../models/incapacidad.model.js';
import { fechaBreve, fechaEnColombia } from '../servicios/dias-habiles.js';
import { mensajeAvisoFallido } from './aviso-fallido.js';

const texto = (valor) => (typeof valor === 'string' ? valor : '');

export function crearRutasReportes({ control }) {
  const rutas = Router();

  const pagina = async (res, estado, { periodo, errores = {} } = {}) => {
    const datos = await control.prepararReportes();
    return res.status(estado).pagina('reportes/generar-reporte', {
      titulo: 'Reportes',
      errores,
      periodo: periodo ?? datos.periodoSugerido,
      totalesDelReporte,
      fechaBreve,
      fechaEnColombia,
      ...datos,
    });
  };

  rutas.get('/reportes', permitir('generarReporte'), async (req, res) => {
    await pagina(res, 200);
  });

  // generarReporte('ausentismo', periodo) — HU-27. Datos no válidos o periodo sin incapacidades: 400; el envío al
  // SG-SST falló y se deshizo: 502. Si se guardó, se pasa al reporte.
  rutas.post('/reportes/ausentismo', permitir('generarReporte'), async (req, res) => {
    const periodo = texto(req.body?.periodo).slice(0, 20);
    try {
      const { idReporte } = await control.generarReporte('ausentismo', { periodo }, req.usuario);
      res.redirect(303, `/reportes/${idReporte}?generado=1`);
    } catch (error) {
      if (error instanceof ErrorDeValidacion) return pagina(res, 400, { periodo, errores: error.errores });
      if (!(error instanceof ErrorDeAviso)) throw error;
      if (error.deshecho) return pagina(res, 502, { periodo, errores: { aviso: mensajeAvisoFallido('al SG-SST') } });
      return res.status(500).pagina('error', {
        titulo: 'No se pudo completar el reporte',
        mensaje:
          'El correo al SG-SST falló y no se pudo deshacer el reporte: pudo quedar guardado sin enviarse. ' +
          'Revise los reportes recientes y entregue el reporte al SG-SST por otro medio.',
      });
    }
  });

  rutas.get('/reportes/:id', permitir('generarReporte'), async (req, res, siguiente) => {
    const id = /^\d{1,15}$/.test(req.params.id) ? Number(req.params.id) : null;
    const reporte = id ? await control.consultarReporte(id) : null;
    if (!reporte || reporte.tipo !== 'ausentismo') return siguiente();
    res.pagina('reportes/reporte-ausentismo', {
      titulo: `Reporte de ausentismo ${reporte.periodo}`,
      reporte,
      totales: totalesDelReporte(reporte.contenido),
      porTipo: diasPorTipo(reporte.contenido),
      recienGenerado: req.query.generado === '1',
      NOMBRES_ESTADO_INCAPACIDAD,
      NOMBRES_TIPO_INCAPACIDAD,
      fechaBreve,
      fechaEnColombia,
    });
  });

  return rutas;
}
