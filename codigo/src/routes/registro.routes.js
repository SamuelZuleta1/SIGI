// Grupo `registro` de la Interfaz de incapacidades — DS-01 (CU-01, CU-02).
// Operaciones de la Vista: registrarIncapacidad. (registrarDocumentos llega con HU-04.)
import { Router } from 'express';
import { ErrorDeValidacion } from '../controllers/error-de-validacion.js';
import { permitir } from '../middleware/autenticacion.js';
import { NOMBRES_TIPO_INCAPACIDAD } from '../models/incapacidad.model.js';

const CAMPOS = ['colaborador', 'correoColaborador', 'tipo', 'entidad', 'fechaInicio', 'diasIncapacidad', 'fechaRecepcion'];
const hoy = () => new Date().toLocaleDateString('en-CA'); // AAAA-MM-DD en la hora local

export function crearRutasRegistro({ control }) {
  const rutas = Router();

  const formulario = async (res, estado, { valores = {}, errores = {}, registrada = null } = {}) =>
    res.status(estado).pagina('registro/registrar-incapacidad', {
      titulo: 'Registrar incapacidad',
      tipos: NOMBRES_TIPO_INCAPACIDAD,
      entidades: await control.obtenerEntidades(),
      valores: { fechaRecepcion: hoy(), ...valores },
      errores,
      primerError: CAMPOS.find((campo) => errores[campo]) ?? null,
      registrada,
    });

  // Formulario. Tras registrar, se vuelve aquí con ?registrada=<id> para mostrar la confirmación.
  rutas.get('/incapacidades/nueva', permitir('registrarIncapacidad'), async (req, res) => {
    const registrada = /^[1-9]\d{0,17}$/.test(String(req.query.registrada ?? '')) ? req.query.registrada : null;
    await formulario(res, 200, { registrada });
  });

  rutas.post('/incapacidades', permitir('registrarIncapacidad'), async (req, res) => {
    try {
      const { idIncapacidad } = await control.registrarIncapacidad(req.body, req.usuario);
      res.redirect(303, `/incapacidades/nueva?registrada=${idIncapacidad}`);
    } catch (error) {
      if (!(error instanceof ErrorDeValidacion)) throw error;
      const valores = Object.fromEntries(CAMPOS.map((campo) => [campo, String(req.body?.[campo] ?? '').slice(0, 200)]));
      await formulario(res, 400, { valores, errores: error.errores });
    }
  });

  return rutas;
}
