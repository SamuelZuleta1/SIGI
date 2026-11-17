// Grupo `verificacion` de la Interfaz de incapacidades — DS-03 (CU-04).
// Operaciones de la Vista: verificarDocumentacion, confirmarVerificacion, notificarFaltantes (HU-07)
// y «ver documento» (DA-06).
import { Router } from 'express';
import { ErrorDeValidacion } from '../controllers/error-de-validacion.js';
import { permitir, restringirDocumento } from '../middleware/autenticacion.js';
import { NOMBRES_TIPO_DOCUMENTO, TIPOS_DOCUMENTO } from '../models/documento.model.js';
import { NOMBRES_TIPO_INCAPACIDAD } from '../models/incapacidad.model.js';
import { fechaLarga } from '../servicios/dias-habiles.js';

// La casilla «La EPS ya transcribió» (DA-26) llega como eps=si.
const conEps = (valor) => ({ epsTranscribio: valor === 'si' });
const sufijoEps = ({ epsTranscribio }) => (epsTranscribio ? '&eps=si' : '');

// Casillas de faltantes (HU-07): una o varias, como texto o lista. Se acota el tamaño.
const comoLista = (valor) => (Array.isArray(valor) ? valor : valor == null ? [] : [valor]).map(String).slice(0, 20);

// Errores de notificarFaltantes: el correo que no salió es un fallo temporal; lo demás, un conflicto.
const estadoDeError = (errores) => (errores.correo ? 503 : 409);

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
      notificada: false,
      errorAviso: null,
      seleccion: null,
      tiposDocumento: TIPOS_DOCUMENTO,
      fechaLarga,
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

  // verificarDocumentacion → mostrarResultado (HU-06.CA1). Tras confirmar se vuelve con ?verificada=1
  // y tras notificar los faltantes, con ?notificada=1 (HU-07).
  // «Añadir» otro documento a la lista de faltantes funciona sin JavaScript: el formulario vuelve aquí
  // por GET con accion=agregar, las casillas marcadas y el tipo elegido en `otro` (DA-30).
  rutas.get('/incapacidades/:id/verificacion', permitir('verificarDocumentacion'), async (req, res) => {
    const verificacion = await control.verificarDocumentacion(req.params.id, conEps(req.query.eps));
    if (!verificacion) return noExiste(res, req.params.id);
    // Las confirmaciones solo se muestran si de verdad ocurrió lo que dicen (no basta con la URL).
    const verificada = req.query.verificada === '1' && verificacion.incapacidad.archivadoDigital;
    const notificada = req.query.notificada === '1' && Boolean(verificacion.aviso?.pendiente);
    const seleccion =
      req.query.accion === 'agregar' ? [...comoLista(req.query.faltantes), ...comoLista(req.query.otro)] : null;
    await pagina(res, 200, { verificacion, verificada, notificada, seleccion });
  });

  // notificarFaltantes → guardarFaltantes → correo al colaborador (HU-07.CA1).
  rutas.post('/incapacidades/:id/faltantes', permitir('notificarFaltantes'), async (req, res) => {
    const opciones = conEps(req.body?.eps);
    const seleccion = comoLista(req.body?.faltantes);
    try {
      const { idIncapacidad } = await control.notificarFaltantes(req.params.id, seleccion, opciones);
      res.redirect(303, `/incapacidades/${idIncapacidad}/verificacion?notificada=1${sufijoEps(opciones)}#aviso`);
    } catch (error) {
      if (!(error instanceof ErrorDeValidacion)) throw error;
      const verificacion = await control.verificarDocumentacion(req.params.id, opciones);
      if (!verificacion) return noExiste(res, req.params.id);
      const { errores } = error;
      await pagina(res, estadoDeError(errores), {
        verificacion,
        seleccion,
        errorAviso: errores.correo ?? errores.faltantes ?? errores.incapacidad,
      });
    }
  });

  // confirmarVerificacion → registrarVerificacion → archivarDigital (HU-06.CA2).
  rutas.post('/incapacidades/:id/verificacion', permitir('confirmarVerificacion'), async (req, res) => {
    const opciones = conEps(req.body?.eps);
    try {
      const { idIncapacidad } = await control.registrarVerificacion(req.params.id, opciones);
      res.redirect(303, `/incapacidades/${idIncapacidad}/verificacion?verificada=1${sufijoEps(opciones)}`);
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
