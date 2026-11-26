// Grupo `registro` de la Interfaz de incapacidades — DS-01 (CU-01, CU-02).
// Operaciones de la Vista: registrarIncapacidad, registrarDocumentos.
import { Router } from 'express';
import multer from 'multer';
import { ErrorDeValidacion } from '../controllers/error-de-validacion.js';
import { TAMANO_MAXIMO_ARCHIVO } from '../controllers/registro.controller.js';
import { permitir } from '../middleware/autenticacion.js';
import { NOMBRES_TIPO_DOCUMENTO, TIPOS_DOCUMENTO } from '../models/documento.model.js';
import { NOMBRES_TIPO_INCAPACIDAD } from '../models/incapacidad.model.js';
import { fechaBreve, hoyEnColombia } from '../servicios/dias-habiles.js';
import { archivosDePeticion, MENSAJE_SUBIDA_PERDIDA } from './subidas.js';

// Los archivos se reciben en memoria y el Control los pasa al bucket privado: nunca tocan el disco del servidor.
// Un campo de archivo por tipo de documento (DA-06).
const recibirArchivos = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANO_MAXIMO_ARCHIVO, files: TIPOS_DOCUMENTO.length, fields: 0 },
}).fields(TIPOS_DOCUMENTO.map((tipo) => ({ name: tipo, maxCount: 1 })));

const CAMPOS = ['colaborador', 'correoColaborador', 'tipo', 'entidad', 'fechaInicio', 'diasIncapacidad', 'fechaRecepcion', 'fechaNacimiento'];
// AAAA-MM-DD en Colombia: con la hora del servidor (UTC en Vercel), de noche propondría mañana y el registro la rechaza.
const hoy = hoyEnColombia;

export function crearRutasRegistro({ control }) {
  const rutas = Router();

  const formulario = async (res, estado, { valores = {}, errores = {}, registrada = null } = {}) =>
    res.status(estado).pagina('registro/registrar-incapacidad', {
      titulo: 'Registrar incapacidad',
      tipos: NOMBRES_TIPO_INCAPACIDAD,
      entidades: await control.obtenerEntidades(),
      valores: { fechaRecepcion: hoy(), ...valores },
      hoy: hoy(),
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

  // ----- prórroga (DA-50, opción C): se busca la anterior por su n.º y el formulario llega con lo que no cambia -----

  const CAMPOS_PRORROGA = ['fechaInicio', 'diasIncapacidad', 'fechaRecepcion'];
  const paginaProrroga = (res, estado, datos = {}) =>
    res.status(estado).pagina('registro/registrar-prorroga', {
      titulo: 'Registrar prórroga',
      tipos: NOMBRES_TIPO_INCAPACIDAD,
      fechaBreve,
      numero: '',
      errorNumero: null,
      preparada: null,
      valores: {},
      errores: {},
      primerError: null,
      ...datos,
    });

  // Paso 1 (sin ?anterior): el n.º de la incapacidad que se prorroga. Paso 2: el formulario con la anterior precargada.
  rutas.get('/incapacidades/prorroga', permitir('registrarIncapacidad'), async (req, res) => {
    const numero = String(req.query.anterior ?? '').trim().slice(0, 20);
    if (numero === '') return paginaProrroga(res, 200);
    const preparada = await control.prepararProrroga(numero);
    if (!preparada) return paginaProrroga(res, 404, { numero, errorNumero: 'No hay una incapacidad con ese número.' });
    await paginaProrroga(res, 200, {
      numero,
      preparada,
      valores: { fechaInicio: preparada.anterior.fechaSugerida, fechaRecepcion: hoy() },
    });
  });

  // registrarIncapacidad de una prórroga (DA-50). Datos no válidos: 400; la anterior ya no admite prórroga: 409.
  rutas.post('/incapacidades/prorroga', permitir('registrarIncapacidad'), async (req, res) => {
    const numero = String(req.body?.anterior ?? '').trim().slice(0, 20);
    try {
      const resultado = await control.registrarProrroga(numero, req.body, req.usuario);
      if (!resultado) return paginaProrroga(res, 404, { numero, errorNumero: 'No hay una incapacidad con ese número.' });
      res.redirect(303, `/incapacidades/nueva?registrada=${resultado.idIncapacidad}`);
    } catch (error) {
      if (!(error instanceof ErrorDeValidacion)) throw error;
      const preparada = await control.prepararProrroga(numero);
      if (!preparada) return paginaProrroga(res, 404, { numero, errorNumero: 'No hay una incapacidad con ese número.' });
      const valores = Object.fromEntries(CAMPOS_PRORROGA.map((campo) => [campo, String(req.body?.[campo] ?? '').slice(0, 20)]));
      await paginaProrroga(res, error.errores.anterior ? 409 : 400, {
        numero,
        preparada: error.errores.anterior ? { ...preparada, impedimento: error.errores.anterior } : preparada,
        valores,
        errores: error.errores,
        primerError: CAMPOS_PRORROGA.find((campo) => error.errores[campo]) ?? null,
      });
    }
  });

  // ----- registrarDocumentos (HU-04, CU-02) -----

  const paginaDocumentos = (res, estado, datos = {}) =>
    res.status(estado).pagina('registro/registrar-documentos', {
      titulo: 'Registrar documentos',
      incapacidad: null,
      numero: '',
      errorNumero: null,
      tipos: NOMBRES_TIPO_DOCUMENTO,
      nombresTipo: NOMBRES_TIPO_INCAPACIDAD,
      errores: {},
      registrados: null,
      avisoEnviado: true,
      ...datos,
    });

  // Entrada del menú: pide el número de la incapacidad y lleva a su formulario.
  rutas.get('/documentos', permitir('registrarDocumentos'), async (req, res) => {
    const numero = String(req.query.incapacidad ?? '').trim().slice(0, 20);
    if (!numero) return paginaDocumentos(res, 200);
    const incapacidad = await control.obtenerIncapacidad(numero);
    if (!incapacidad) return paginaDocumentos(res, 404, { numero, errorNumero: 'No hay una incapacidad con ese número.' });
    res.redirect(303, `/incapacidades/${incapacidad.idIncapacidad}/documentos`);
  });

  // Formulario. Tras registrar, se vuelve aquí con ?registrados=<cantidad> para mostrar la confirmación.
  rutas.get('/incapacidades/:id/documentos', permitir('registrarDocumentos'), async (req, res) => {
    const incapacidad = await control.obtenerIncapacidad(req.params.id);
    if (!incapacidad) {
      return paginaDocumentos(res, 404, { numero: String(req.params.id).slice(0, 20), errorNumero: 'No hay una incapacidad con ese número.' });
    }
    const registrados = /^[1-9]\d?$/.test(String(req.query.registrados ?? '')) ? Number(req.query.registrados) : null;
    await paginaDocumentos(res, 200, { incapacidad, registrados, avisoEnviado: req.query.aviso !== 'no' });
  });

  rutas.post(
    '/incapacidades/:id/documentos',
    permitir('registrarDocumentos'),
    (req, res, next) =>
      recibirArchivos(req, res, (error) => {
        if (!error) return next();
        if (!(error instanceof multer.MulterError)) return next(error);
        req.errorDeSubida =
          error.code === 'LIMIT_FILE_SIZE' ? 'Un archivo pesa más de 10 MB. No se registró ninguno.' : 'No se pudieron recibir los archivos. Revise e intente de nuevo.';
        next();
      }),
    async (req, res) => {
      // Los archivos llegan en el formulario o, si el navegador los subió directo al bucket (Vercel), como referencias.
      const { archivos, rutas: subidas, perdidos } = await archivosDePeticion(control, req, TIPOS_DOCUMENTO);
      const recibidos = TIPOS_DOCUMENTO.filter((tipo) => archivos[tipo]);
      try {
        if (req.errorDeSubida) throw new ErrorDeValidacion({ documentos: req.errorDeSubida });
        if (perdidos.length > 0) throw new ErrorDeValidacion({ documentos: MENSAJE_SUBIDA_PERDIDA });
        const documentos = recibidos.map((tipo) => ({ tipo, contenido: archivos[tipo] }));
        const { idIncapacidad, cantidad, originalPendiente, avisoEnviado } = await control.registrarDocumentos(
          req.params.id,
          documentos,
          req.usuario,
        );
        const aviso = originalPendiente || avisoEnviado ? '' : '&aviso=no';
        res.redirect(303, `/incapacidades/${idIncapacidad}/documentos?registrados=${cantidad}${aviso}`);
      } catch (error) {
        if (!(error instanceof ErrorDeValidacion)) throw error;
        const incapacidad = await control.obtenerIncapacidad(req.params.id);
        if (!incapacidad) {
          return paginaDocumentos(res, 404, { numero: String(req.params.id).slice(0, 20), errorNumero: error.errores.incapacidad });
        }
        // El Control numera los documentos (documento0, documento1…): aquí se llevan a la fila de su tipo.
        const errores = {};
        for (const [clave, mensaje] of Object.entries(error.errores)) {
          const posicion = /^documento(\d+)$/.exec(clave)?.[1];
          errores[posicion === undefined ? 'documentos' : recibidos[Number(posicion)]] = mensaje;
        }
        await paginaDocumentos(res, 400, { incapacidad, errores });
      } finally {
        await control.descartarSubidas(subidas, req.usuario).catch((error) => console.error('No se pudieron borrar las subidas:', error));
      }
    },
  );

  return rutas;
}
