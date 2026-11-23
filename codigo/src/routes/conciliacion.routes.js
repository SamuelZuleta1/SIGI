// Grupo `conciliacion` de la Interfaz de incapacidades — DS-11 (CU-15).
// Operación de la Vista: registrarPagosConsignados (HU-25), solo Contabilidad y Tesorería (DA-02), en una pantalla
// con la lista de pagos de una entidad y los registrados más recientes (DA-55). Sin JavaScript: «Agregar filas» es
// un botón del mismo formulario que vuelve a mostrarlo con más filas, sin guardar.
// Operación de la Vista: identificarPagos(entidad, detallePagos) (HU-26), solo el auxiliar: GET/POST /conciliacion
// (elegir la entidad y los pagos registrados) y GET /conciliacion/:id (el detalle conciliado o los saldos, DA-56).
import { Router } from 'express';
import { FILAS_INICIALES, FILAS_MAXIMAS, FILAS_POR_AGREGAR, leerFilas, leerPagosElegidos } from '../controllers/conciliacion.controller.js';
import { ErrorDeAviso } from '../controllers/error-de-aviso.js';
import { ErrorDeValidacion } from '../controllers/error-de-validacion.js';
import { permitir } from '../middleware/autenticacion.js';
import { fechaBreve, fechaEnColombia } from '../servicios/dias-habiles.js';
import { pesos } from '../servicios/moneda.js';
import { mensajeAvisoFallido } from './aviso-fallido.js';

const VACIA = Object.freeze({ colaborador: '', dias: '', valor: '' });

/** Las filas que se muestran: las escritas más las vacías hasta `cantidad` (entre FILAS_INICIALES y FILAS_MAXIMAS). */
const completarFilas = (escritas, cantidad) => {
  const total = Math.min(FILAS_MAXIMAS, Math.max(FILAS_INICIALES, cantidad, escritas.length));
  return Array.from({ length: total }, (_, i) => escritas[i] ?? VACIA);
};

export function crearRutasConciliacion({ control }) {
  const rutas = Router();

  const pagina = async (res, estado, { filas = completarFilas([], FILAS_INICIALES), confirmar, ...datos } = {}) =>
    res.status(estado).pagina('conciliacion/registrar-pagos-consignados', {
      titulo: 'Pagos consignados',
      errores: {},
      entidadElegida: '',
      filas,
      filasMaximas: FILAS_MAXIMAS,
      fechaBreve,
      fechaEnColombia,
      pesos,
      ...(await control.prepararPagosConsignados(confirmar)),
      ...datos,
    });

  const texto = (valor) => (typeof valor === 'string' ? valor : '');

  // Tras registrar se vuelve con ?registrados=N&entidad=ID; la confirmación solo aparece si coincide con lo guardado.
  rutas.get('/pagos-consignados', permitir('registrarPagosConsignados'), async (req, res) => {
    await pagina(res, 200, { confirmar: { cantidad: texto(req.query.registrados), entidad: texto(req.query.entidad) } });
  });

  // registrarPagosConsignados(listaPagos) — HU-25. Datos no válidos: 400; el aviso falló y se deshizo: 502.
  rutas.post('/pagos-consignados', permitir('registrarPagosConsignados'), async (req, res) => {
    const escritas = leerFilas(req.body);
    const entidadElegida = texto(req.body?.entidad).slice(0, 20);

    if (req.body?.accion === 'agregar-filas') {
      return pagina(res, 200, { filas: completarFilas(escritas, escritas.length + FILAS_POR_AGREGAR), entidadElegida });
    }

    try {
      const { entidad, cantidad } = await control.registrarPagosConsignados(req.body, req.usuario);
      res.redirect(303, `/pagos-consignados?registrados=${cantidad}&entidad=${entidad.id}`);
    } catch (error) {
      const volver = (estado, errores) => pagina(res, estado, { filas: completarFilas(escritas, escritas.length), entidadElegida, errores });
      if (error instanceof ErrorDeValidacion) return volver(400, error.errores);
      if (!(error instanceof ErrorDeAviso)) throw error;
      if (error.deshecho) return volver(502, { aviso: mensajeAvisoFallido('al auxiliar') });
      return res.status(500).pagina('error', {
        titulo: 'No se pudo completar el registro',
        mensaje:
          'El correo al auxiliar falló y no se pudo deshacer el registro: los pagos pudieron quedar guardados sin aviso. ' +
          'Revise la lista de pagos registrados antes de volver a escribirlos y avise al auxiliar por otro medio.',
      });
    }
  });

  // ---------- HU-26: identificar los pagos y conciliar (auxiliar) ----------
  const paginaConciliar = async (res, estado, { entidad, elegidos = null, errores = {} } = {}) => {
    const datos = await control.prepararConciliacion(entidad);
    return res.status(estado).pagina('conciliacion/conciliar-pagos', {
      titulo: 'Conciliar pagos',
      errores,
      // Sin una elección previa, todos los pagos registrados de la entidad van marcados.
      elegidos: elegidos ?? datos.pagos.map((p) => p.idPago),
      fechaBreve,
      fechaEnColombia,
      pesos,
      ...datos,
    });
  };

  rutas.get('/conciliacion', permitir('identificarPagos'), async (req, res) => {
    await paginaConciliar(res, 200, { entidad: texto(req.query.entidad).slice(0, 20) });
  });

  // identificarPagos(entidad, detallePagos) — HU-26. Datos no válidos: 400; lo comparado cambió: 409; el correo a
  // Contabilidad falló y se deshizo: 502. Si se guardó, se pasa a la conciliación (CA2 confirmación, CA3 saldos).
  rutas.post('/conciliacion', permitir('identificarPagos'), async (req, res) => {
    const entidad = texto(req.body?.entidad).slice(0, 20);
    try {
      const { idConciliacion } = await control.identificarPagos(req.body, req.usuario);
      res.redirect(303, `/conciliacion/${idConciliacion}?registrada=1`);
    } catch (error) {
      const volver = (estado, errores) =>
        paginaConciliar(res, estado, { entidad, elegidos: errores.cambio ? null : leerPagosElegidos(req.body?.pagos), errores });
      if (error instanceof ErrorDeValidacion) return volver(error.errores.cambio ? 409 : 400, error.errores);
      if (!(error instanceof ErrorDeAviso)) throw error;
      if (error.deshecho) return volver(502, { aviso: mensajeAvisoFallido('a Contabilidad y Tesorería') });
      return res.status(500).pagina('error', {
        titulo: 'No se pudo completar la conciliación',
        mensaje:
          'El correo a Contabilidad y Tesorería falló y no se pudo deshacer la conciliación: pudo quedar guardada sin aviso. ' +
          'Revise las conciliaciones recientes y avise a Contabilidad y Tesorería por otro medio.',
      });
    }
  });

  rutas.get('/conciliacion/:id', permitir('identificarPagos'), async (req, res, siguiente) => {
    const id = /^\d{1,15}$/.test(req.params.id) ? Number(req.params.id) : null;
    const conciliacion = id ? await control.consultarConciliacion(id) : null;
    if (!conciliacion) return siguiente();
    res.pagina('conciliacion/conciliacion', {
      titulo: `Conciliación n.º ${conciliacion.id}`,
      conciliacion,
      recienRegistrada: req.query.registrada === '1',
      fechaBreve,
      fechaEnColombia,
      pesos,
    });
  });

  return rutas;
}
