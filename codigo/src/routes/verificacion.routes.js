// Grupo `verificacion` de la Interfaz de incapacidades — DS-03 (CU-04).
// Operaciones de la Vista: verificarDocumentacion, confirmarVerificacion y «ver documento» (DA-06).
import { Router } from 'express';
import { ErrorDeValidacion } from '../controllers/error-de-validacion.js';
import { permitir, restringirDocumento } from '../middleware/autenticacion.js';
import { NOMBRES_TIPO_DOCUMENTO } from '../models/documento.model.js';
import { NOMBRES_TIPO_INCAPACIDAD } from '../models/incapacidad.model.js';

// La casilla «La EPS ya transcribió» (DA-26) llega como eps=si.
const conEps = (valor) => ({ epsTranscribio: valor === 'si' });

export function crearRutasVerificacion({ control }) {
  const rutas = Router();

  const pagina = (res, estado, datos = {}) =>
    res.status(estado).pagina('verificacion/verificar-documentacion', {
      titulo: 'Verificar documentación',
      verificacion: null,
      numero: '',
      errorNumero: null,
      error: null,
      verificada: false,
      nombresDocumento: NOMBRES_TIPO_DOCUMENTO,
      nombresTipo: NOMBRES_TIPO_INCAPACIDAD,
      ...datos,
    });

  const noExiste = (res, numero) =>
    pagina(res, 404, { numero: String(numero ?? '').slice(0, 20), errorNumero: 'No hay una incapacidad con ese número.' });

  // Entrada del menú: pide el número de la incapacidad y lleva a su verificación.
  rutas.get('/verificacion', permitir('verificarDocumentacion'), async (req, res) => {
    const numero = String(req.query.incapacidad ?? '').trim().slice(0, 20);
    if (!numero) return pagina(res, 200);
    const verificacion = await control.verificarDocumentacion(numero);
    if (!verificacion) return noExiste(res, numero);
    res.redirect(303, `/incapacidades/${verificacion.incapacidad.idIncapacidad}/verificacion`);
  });

  // verificarDocumentacion → mostrarResultado (HU-06.CA1). Tras confirmar se vuelve con ?verificada=1.
  rutas.get('/incapacidades/:id/verificacion', permitir('verificarDocumentacion'), async (req, res) => {
    const verificacion = await control.verificarDocumentacion(req.params.id, conEps(req.query.eps));
    if (!verificacion) return noExiste(res, req.params.id);
    await pagina(res, 200, { verificacion, verificada: req.query.verificada === '1' });
  });

  // confirmarVerificacion → registrarVerificacion → archivarDigital (HU-06.CA2).
  rutas.post('/incapacidades/:id/verificacion', permitir('confirmarVerificacion'), async (req, res) => {
    const opciones = conEps(req.body?.eps);
    try {
      const { idIncapacidad } = await control.registrarVerificacion(req.params.id, opciones);
      res.redirect(303, `/incapacidades/${idIncapacidad}/verificacion?verificada=1${opciones.epsTranscribio ? '&eps=si' : ''}`);
    } catch (error) {
      if (!(error instanceof ErrorDeValidacion)) throw error;
      const verificacion = await control.verificarDocumentacion(req.params.id, opciones);
      if (!verificacion) return noExiste(res, req.params.id);
      await pagina(res, 409, { verificacion, error: error.errores.documentos });
    }
  });

  // DA-06: ver un documento. HU-02: la historia clínica y la epicrisis, solo el auxiliar.
  rutas.get(
    '/documentos/:id/archivo',
    permitir('verDocumento'),
    async (req, res, next) => {
      const documento = await control.obtenerDocumento(req.params.id);
      if (!documento) {
        return res.status(404).pagina('error', { titulo: 'Documento no encontrado', mensaje: 'El documento que busca no existe.' });
      }
      req.documento = documento;
      next();
    },
    restringirDocumento((req) => req.documento.tipo),
    async (req, res) => {
      const { contenido, tipoMime, nombre } = await control.verDocumento(req.documento);
      res.set({
        'Content-Type': tipoMime,
        // Se abre en el navegador; con un tipo desconocido, se descarga.
        'Content-Disposition': `${tipoMime === 'application/octet-stream' ? 'attachment' : 'inline'}; filename="${nombre}"`,
        // Documentos de salud: que no queden en cachés intermedias ni en la del navegador.
        'Cache-Control': 'no-store',
      });
      res.send(contenido);
    },
  );

  return rutas;
}
