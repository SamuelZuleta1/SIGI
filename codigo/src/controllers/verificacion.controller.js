// Grupo `verificacion` del Control de incapacidades — DS-03 (CU-04).
// Operaciones: verificarDocumentacion (con compararConRequisitos), registrarVerificacion
// y «ver documento» (DA-06). notificarFaltantes y registrarSegundoLlamado llegan con HU-07 y HU-08.
import { ErrorDeValidacion } from './error-de-validacion.js';

const esIdentificador = (valor) => /^[1-9]\d{0,17}$/.test(String(valor ?? ''));

// La epicrisis se exime si la EPS ya transcribió (F1 §2.8; DA-26).
const EXIMIBLE = new Set(['enfermedad_laboral', 'accidente_laboral']);

/** ¿Se le puede aplicar a esta incapacidad la excepción «la EPS ya transcribió»? (DA-26) */
export const admiteExencion = ({ tipo, diasIncapacidad }) =>
  EXIMIBLE.has(tipo) || (tipo === 'enfermedad_general' && diasIncapacidad > 2);

/**
 * Documentos obligatorios por tipo de caso (F1 §2.8; DA-27 para la paternidad).
 * @returns {Array<{ tipo: string, exento: boolean }>} en el orden en que se muestran.
 */
export function documentosObligatorios({ tipo, diasIncapacidad }, { epsTranscribio = false } = {}) {
  const lista = [];
  const exigir = (...tipos) => tipos.forEach((t) => lista.push({ tipo: t, exento: false }));
  const epicrisisEximible = () => lista.push({ tipo: 'epicrisis', exento: epsTranscribio });

  if (tipo !== 'licencia_paternidad') exigir('soporte_incapacidad');
  if (tipo === 'enfermedad_general' && diasIncapacidad > 2) epicrisisEximible();
  if (EXIMIBLE.has(tipo)) epicrisisEximible();
  if (tipo === 'accidente_transito') exigir('epicrisis', 'furips');
  if (tipo === 'licencia_maternidad' || tipo === 'licencia_paternidad') {
    exigir('epicrisis', 'certificado_nacido_vivo', 'registro_civil', 'documento_identidad');
  }
  return lista;
}

/**
 * DS-03: compararConRequisitos(). Cruza los obligatorios con los documentos del expediente.
 * @param {{ tipo: string, diasIncapacidad: number }} incapacidad
 * @param {Array<{ idDocumento: number, tipo: string }>} documentos
 */
export function compararConRequisitos(incapacidad, documentos, { epsTranscribio = false } = {}) {
  const exencion = admiteExencion(incapacidad) && epsTranscribio;
  const delTipo = (tipo) => documentos.filter((d) => d.tipo === tipo).map((d) => d.idDocumento);
  const requisitos = documentosObligatorios(incapacidad, { epsTranscribio: exencion }).map(({ tipo, exento }) => {
    const recibidos = delTipo(tipo);
    const estado = exento ? 'exento' : recibidos.length > 0 ? 'recibido' : 'falta';
    return { tipo, estado, documentos: recibidos };
  });
  const exigidos = new Set(requisitos.map((r) => r.tipo));
  const otros = [...new Set(documentos.map((d) => d.tipo))]
    .filter((tipo) => !exigidos.has(tipo))
    .map((tipo) => ({ tipo, documentos: delTipo(tipo) }));
  const faltantes = requisitos.filter((r) => r.estado === 'falta').map((r) => r.tipo);
  return {
    requisitos,
    otros,
    faltantes,
    completa: faltantes.length === 0,
    exigidos: requisitos.filter((r) => r.estado !== 'exento').length,
    recibidos: requisitos.filter((r) => r.estado === 'recibido').length,
    epsTranscribio: exencion,
  };
}

export function crearControlVerificacion({ baseDeDatos }) {
  const expediente = async (idIncapacidad) =>
    esIdentificador(idIncapacidad) ? baseDeDatos.obtenerExpediente(Number(idIncapacidad)) : null;

  return {
    /**
     * DS-03: verificarDocumentacion(idIncapacidad) → resultadoVerificacion(faltantes).
     * Solo consulta: si faltan documentos no se guarda nada (HU-06.CA3).
     * @returns {Promise<null | { incapacidad: object, resultado: object }>} null si no existe.
     */
    async verificarDocumentacion(idIncapacidad, { epsTranscribio = false } = {}) {
      const datos = await expediente(idIncapacidad);
      if (!datos) return null;
      const { documentos, ...incapacidad } = datos;
      return {
        incapacidad: { ...incapacidad, admiteExencion: admiteExencion(incapacidad) },
        resultado: compararConRequisitos(incapacidad, documentos, { epsTranscribio }),
      };
    },

    /**
     * DS-03: confirmarVerificacion → registrarVerificacion(idIncapacidad) → archivarDigital.
     * Vuelve a comparar en el servidor: con faltantes no registra ni archiva (HU-06.CA3).
     * El original en físico pendiente se advierte en pantalla pero no impide confirmar (DA-28).
     */
    async registrarVerificacion(idIncapacidad, { epsTranscribio = false } = {}) {
      const verificacion = await this.verificarDocumentacion(idIncapacidad, { epsTranscribio });
      if (!verificacion) throw new ErrorDeValidacion({ incapacidad: 'No hay una incapacidad con ese número.' });
      if (!verificacion.resultado.completa) {
        throw new ErrorDeValidacion({ documentos: 'Faltan documentos obligatorios: la documentación no se archivó.' });
      }
      await baseDeDatos.archivarDigital(verificacion.incapacidad.idIncapacidad);
      return { idIncapacidad: verificacion.incapacidad.idIncapacidad };
    },

    /** Tipo e incapacidad de un documento, o null. Lo usa la ruta para aplicar HU-02 antes de entregarlo. */
    async obtenerDocumento(idDocumento) {
      return esIdentificador(idDocumento) ? baseDeDatos.consultarDocumento(Number(idDocumento)) : null;
    },

    /**
     * DA-06: ver o descargar un documento. El archivo lo entrega el servidor desde el bucket privado.
     * Recibe el documento de `obtenerDocumento`: la ruta lo consulta primero para aplicar el permiso
     * por tipo (HU-02, `restringirDocumento`) y solo después se descarga el archivo.
     * @returns {Promise<{ tipo: string, contenido: Buffer, tipoMime: string, nombre: string }>}
     */
    async verDocumento(documento) {
      const { contenido, tipoMime } = await baseDeDatos.descargarDocumento(documento.archivo);
      const extension = documento.archivo.split('.').pop();
      return { tipo: documento.tipo, contenido, tipoMime, nombre: `${documento.tipo}-${documento.idDocumento}.${extension}` };
    },
  };
}
