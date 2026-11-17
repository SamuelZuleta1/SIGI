// Grupo `verificacion` del Control de incapacidades — DS-03 (CU-04).
// Operaciones: verificarDocumentacion (con compararConRequisitos), registrarVerificacion,
// notificarFaltantes (HU-07) y «ver documento» (DA-06). registrarSegundoLlamado llega con HU-08.
import { NOMBRES_TIPO_DOCUMENTO, TIPOS_DOCUMENTO } from '../models/documento.model.js';
import { diasHabilesRestantes, fechaLarga, hoyEnColombia, sumarDiasHabiles } from '../servicios/dias-habiles.js';
import { ErrorDeValidacion } from './error-de-validacion.js';
import { esIdentificador } from './identificador.js';

// Plazo para entregar los faltantes (CU-05, DA-13): 3 días hábiles desde el aviso.
export const DIAS_PARA_ENTREGAR = 3;


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

/**
 * Lista de faltantes que envía el auxiliar (DA-30): tipos del catálogo, sin repetir, al menos uno.
 * @returns {string[]} los tipos en el orden del catálogo.
 */
export function validarFaltantes(tipos) {
  const lista = (Array.isArray(tipos) ? tipos : [tipos]).filter((t) => t != null && t !== '');
  if (lista.length === 0) throw new ErrorDeValidacion({ faltantes: 'Marque al menos un documento.' });
  if (lista.some((t) => !TIPOS_DOCUMENTO.includes(t))) {
    throw new ErrorDeValidacion({ faltantes: 'Hay un documento que no está en la lista de tipos.' });
  }
  return TIPOS_DOCUMENTO.filter((t) => lista.includes(t));
}

export function crearControlVerificacion({ baseDeDatos, correo, hoy = hoyEnColombia }) {
  const expediente = async (idIncapacidad) =>
    esIdentificador(idIncapacidad) ? baseDeDatos.obtenerExpediente(Number(idIncapacidad)) : null;

  // Último aviso de faltantes (DA-29: se conserva aunque lleguen documentos), con su plazo.
  const ultimoAviso = ({ fechaAvisoFaltantes, faltantes, documentacionCompleta }) => {
    if (!fechaAvisoFaltantes) return null;
    const fechaLimite = sumarDiasHabiles(fechaAvisoFaltantes, DIAS_PARA_ENTREGAR);
    return {
      faltantes: faltantes ?? [],
      fechaAviso: fechaAvisoFaltantes,
      fechaLimite,
      diasRestantes: diasHabilesRestantes(hoy(), fechaLimite),
      // false = el aviso sigue pendiente: no se puede volver a notificar hasta que lleguen documentos (DA-31).
      pendiente: documentacionCompleta === false,
    };
  };

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
        aviso: ultimoAviso(incapacidad),
        // Hasta cuándo tendría el colaborador si se le notifica hoy (se muestra antes de enviar).
        fechaLimiteSiSeNotifica: sumarDiasHabiles(hoy(), DIAS_PARA_ENTREGAR),
      };
    },

    /**
     * DS-03: notificarFaltantes(idIncapacidad, faltantes) → guardarFaltantes → notificarFaltantes(Colaborador).
     * HU-07.CA1: envía al colaborador el correo con los documentos y el plazo de 3 días hábiles y guarda
     * la lista con la fecha del aviso (DA-13).
     * - La lista la edita el auxiliar a partir de los faltantes calculados (DA-30).
     * - Con un aviso pendiente no se notifica de nuevo hasta que se registren documentos (DA-31).
     * - Primero el correo y después el registro: si el correo falla no queda un aviso que nadie recibió
     *   ni corre un plazo; el auxiliar puede reintentar.
     */
    async notificarFaltantes(idIncapacidad, tipos, { epsTranscribio = false } = {}) {
      const verificacion = await this.verificarDocumentacion(idIncapacidad, { epsTranscribio });
      if (!verificacion) throw new ErrorDeValidacion({ incapacidad: 'No hay una incapacidad con ese número.' });
      const { incapacidad, resultado, aviso } = verificacion;
      if (aviso?.pendiente) {
        throw new ErrorDeValidacion({
          faltantes: 'Ya se notificaron los faltantes. Podrá notificar de nuevo cuando se registren documentos y sigan faltando.',
        });
      }
      if (resultado.completa) {
        throw new ErrorDeValidacion({ faltantes: 'La documentación está completa: no hay faltantes que notificar.' });
      }
      const faltantes = validarFaltantes(tipos);

      const fechaAviso = hoy();
      const fechaLimite = sumarDiasHabiles(fechaAviso, DIAS_PARA_ENTREGAR);
      try {
        await correo.notificarFaltantes(
          incapacidad,
          faltantes.map((t) => NOMBRES_TIPO_DOCUMENTO[t]),
          fechaLarga(fechaLimite),
        );
      } catch (error) {
        console.error('No se pudo enviar notificarFaltantes:', error);
        throw new ErrorDeValidacion({
          correo: 'No se pudo enviar el correo al colaborador, así que el aviso no se registró. Intente de nuevo.',
        });
      }
      const guardado = await baseDeDatos.guardarFaltantes(incapacidad.idIncapacidad, faltantes, fechaAviso);
      if (!guardado) {
        throw new ErrorDeValidacion({ faltantes: 'Otro usuario registró el aviso al mismo tiempo. Revise el resultado.' });
      }
      return { idIncapacidad: incapacidad.idIncapacidad, faltantes, fechaAviso, fechaLimite };
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
