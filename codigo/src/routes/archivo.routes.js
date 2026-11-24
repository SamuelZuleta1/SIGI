// Grupo `archivo` de la Interfaz de incapacidades — DS-13 (CU-17).
// Operaciones de la Vista: consultarPagadas (HU-29.CA1, GET /archivo) y archivarIncapacidad (HU-29.CA2/CA3, desde una
// pantalla por incapacidad: GET/POST /incapacidades/:id/archivo). DA-59.
// registrarEnvioArchivo (HU-30, POST /incapacidades/:id/archivo/envio): último paso de esa misma pantalla. DA-60.
import { Router } from 'express';
import { ErrorAlEliminarEpicrisis } from '../controllers/archivo.controller.js';
import { ErrorDeAviso } from '../controllers/error-de-aviso.js';
import { ErrorDeValidacion } from '../controllers/error-de-validacion.js';
import { permitir } from '../middleware/autenticacion.js';
import { NOMBRES_TIPO_DOCUMENTO } from '../models/documento.model.js';
import { NOMBRES_TIPO_INCAPACIDAD } from '../models/incapacidad.model.js';
import { fechaBreve, fechaEnColombia } from '../servicios/dias-habiles.js';
import { pesos } from '../servicios/moneda.js';

// Si el correo falla, la marca se quita; la epicrisis que ya se eliminó no vuelve (DA-59).
const AVISO_FALLIDO =
  'No se pudo enviar el correo a Gestión Documental: el archivo no quedó preparado. Intente de nuevo. ' +
  'Si la incapacidad tenía epicrisis, ya se eliminó de SIGI.';
const EPICRISIS_FALLIDA = 'No se pudo eliminar la epicrisis: el archivo no quedó preparado y no se avisó a Gestión Documental. Intente de nuevo.';

export function crearRutasArchivo({ control }) {
  const rutas = Router();
  const ayudas = { fechaBreve, fechaEnColombia, pesos, nombresTipo: NOMBRES_TIPO_INCAPACIDAD, nombresDocumento: NOMBRES_TIPO_DOCUMENTO };

  const noExiste = (res) =>
    res.status(404).pagina('error', { titulo: 'Incapacidad no encontrada', mensaje: 'No hay una incapacidad pagada con ese número.' });

  const pagina = (res, estado, datos) =>
    res.status(estado).pagina('archivo/archivar-incapacidad', {
      titulo: 'Archivar incapacidad',
      errores: {},
      preparado: false,
      enviada: false,
      ...ayudas,
      ...datos,
    });

  // consultarPagadas() — HU-29.CA1. Solo consulta.
  rutas.get('/archivo', permitir('consultarPagadas'), async (req, res) => {
    const datos = await control.consultarPagadas(String(req.query.ver ?? 'por_archivar'));
    res.pagina('archivo/consultar-pagadas', { titulo: 'Archivo', ...datos, ...ayudas });
  });

  // Tras archivar se vuelve con ?preparado=1 y tras registrar el envío con ?enviada=1; cada confirmación solo aparece
  // si la incapacidad de verdad está en ese punto.
  rutas.get('/incapacidades/:id/archivo', permitir('consultarPagadas'), async (req, res) => {
    const archivo = await control.prepararArchivo(req.params.id);
    if (!archivo) return noExiste(res);
    await pagina(res, 200, {
      archivo,
      preparado: req.query.preparado === '1' && archivo.situacion === 'preparado',
      enviada: req.query.enviada === '1' && archivo.situacion === 'enviada',
    });
  });

  // archivarIncapacidad() — HU-29.CA2/CA3. Sin conciliar, ya preparado o no pagada: 409 con la advertencia.
  // El correo o el borrado de la epicrisis fallaron: 502 (se quitó la marca) o 500 (no se pudo quitar).
  rutas.post('/incapacidades/:id/archivo', permitir('archivarIncapacidad'), async (req, res) => {
    try {
      const resultado = await control.archivarIncapacidad(req.params.id, req.usuario);
      if (!resultado) return noExiste(res);
      res.redirect(303, `/incapacidades/${resultado.idIncapacidad}/archivo?preparado=1`);
    } catch (error) {
      const fallo = error instanceof ErrorDeAviso || error instanceof ErrorAlEliminarEpicrisis;
      if (fallo && !error.deshecho) {
        return res.status(500).pagina('error', {
          titulo: 'No se pudo completar el archivo',
          mensaje:
            `${error instanceof ErrorDeAviso ? 'El correo a Gestión Documental falló' : 'No se pudo eliminar la epicrisis'} ` +
            'y no se pudo quitar la marca de archivo preparado. ' +
            `Abra la incapacidad n.º ${error.idIncapacidad} para comprobarlo y avise a Gestión Documental por otro medio.`,
        });
      }
      if (!fallo && !(error instanceof ErrorDeValidacion)) throw error;
      const archivo = await control.prepararArchivo(req.params.id);
      if (!archivo) return noExiste(res);
      if (error instanceof ErrorDeValidacion) return pagina(res, 409, { archivo, errores: error.errores });
      await pagina(res, 502, { archivo, errores: { aviso: error instanceof ErrorDeAviso ? AVISO_FALLIDO : EPICRISIS_FALLIDA } });
    }
  });

  // registrarEnvioArchivo() — HU-30.CA1. Sin la casilla: 400; sin archivo preparado o ya enviada: 409.
  rutas.post('/incapacidades/:id/archivo/envio', permitir('registrarEnvioArchivo'), async (req, res) => {
    try {
      const resultado = await control.registrarEnvioArchivo(req.params.id, { entregado: req.body?.entregado === 'si' }, req.usuario);
      if (!resultado) return noExiste(res);
      res.redirect(303, `/incapacidades/${resultado.idIncapacidad}/archivo?enviada=1`);
    } catch (error) {
      if (!(error instanceof ErrorDeValidacion)) throw error;
      const archivo = await control.prepararArchivo(req.params.id);
      if (!archivo) return noExiste(res);
      await pagina(res, error.errores.entregado ? 400 : 409, { archivo, errores: error.errores });
    }
  });

  return rutas;
}
