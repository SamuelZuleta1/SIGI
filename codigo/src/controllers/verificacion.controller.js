// Grupo `verificacion` del Control de incapacidades — DS-03 (CU-04).
// Operaciones: verificarDocumentacion (con compararConRequisitos), registrarVerificacion,
// notificarFaltantes (HU-07), registrarSegundoLlamado (HU-08) y «ver documento» (DA-06).
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
  // DA-59: al preparar el archivo (HU-29) se elimina la epicrisis. Que ya no esté no es un faltante: se muestra como
  // eliminada, sin afirmar si se archivó con ella o con la transcripción (DA-26 no se guarda).
  const epicrisisEliminada = Boolean(incapacidad.archivoPreparado);
  const delTipo = (tipo) => documentos.filter((d) => d.tipo === tipo).map((d) => d.idDocumento);
  const requisitos = documentosObligatorios(incapacidad, { epsTranscribio: exencion }).map(({ tipo, exento }) => {
    const recibidos = delTipo(tipo);
    const eliminada = epicrisisEliminada && tipo === 'epicrisis' && recibidos.length === 0;
    const estado = eliminada ? 'eliminada' : exento ? 'exento' : recibidos.length > 0 ? 'recibido' : 'falta';
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
    exigidos: requisitos.filter((r) => r.estado !== 'exento' && r.estado !== 'eliminada').length,
    recibidos: requisitos.filter((r) => r.estado === 'recibido').length,
    epsTranscribio: exencion && !epicrisisEliminada,
    epicrisisEliminada: requisitos.some((r) => r.estado === 'eliminada'),
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

  // Último aviso de faltantes (DA-29: se conserva aunque lleguen documentos), con su plazo
  // y el estado de su segundo llamado (HU-08).
  const ultimoAviso = ({ fechaAvisoFaltantes, faltantes, documentacionCompleta, segundoLlamado }) => {
    if (!fechaAvisoFaltantes) return null;
    const fechaLimite = sumarDiasHabiles(fechaAvisoFaltantes, DIAS_PARA_ENTREGAR);
    return {
      faltantes: faltantes ?? [],
      fechaAviso: fechaAvisoFaltantes,
      fechaLimite,
      diasRestantes: diasHabilesRestantes(hoy(), fechaLimite),
      // El colaborador tiene todo el día límite; desde el día siguiente el plazo está vencido (DA-32).
      vencido: hoy() > fechaLimite,
      // false = el aviso sigue pendiente: no se puede volver a notificar hasta que lleguen documentos (DA-31).
      pendiente: documentacionCompleta === false,
      segundoLlamado: Boolean(segundoLlamado),
      // Primer día hábil en que se puede registrar el segundo llamado (se muestra mientras corre el plazo).
      fechaSegundoLlamado: sumarDiasHabiles(fechaLimite, 1),
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
      let resultado = compararConRequisitos(incapacidad, documentos, { epsTranscribio });
      // Archivada pero hoy «incompleta»: solo pudo archivarse con «La EPS ya transcribió» (DA-26 no se guarda;
      // los documentos no se borran y uno nuevo la reabre, DA-29). Se muestra con esa exención.
      if (incapacidad.archivadoDigital && !resultado.completa && admiteExencion(incapacidad)) {
        const conExencion = compararConRequisitos(incapacidad, documentos, { epsTranscribio: true });
        if (conExencion.completa) resultado = conExencion;
      }
      return {
        incapacidad: { ...incapacidad, admiteExencion: admiteExencion(incapacidad) },
        resultado,
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
      // Ya verificada y archivada: no se piden faltantes. Puede pasar si se archivó con la casilla
      // «La EPS ya transcribió» (DA-26, no se guarda) y luego se consulta sin marcarla.
      if (incapacidad.archivadoDigital) {
        throw new ErrorDeValidacion({ faltantes: 'La documentación ya se verificó y está archivada: no se notifican faltantes.' });
      }
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
     * DS-03: registrarSegundoLlamado(idIncapacidad) → guardarSegundoLlamado → notificarCitacion(Coordinación).
     * HU-08.CA1: el auxiliar ya llamó al colaborador fuera del sistema (DA-07) y lo registra; SIGI avisa por
     * correo a la Coordinación para que lo cite.
     * - Solo con un aviso pendiente cuyo plazo de 3 días hábiles ya venció (DA-32).
     * - Un segundo llamado por aviso (DA-33): un aviso nuevo (HU-07) permite otro.
     * - Primero el correo y después el registro, como en HU-07: si el correo falla no queda nada guardado.
     */
    async registrarSegundoLlamado(idIncapacidad) {
      const verificacion = await this.verificarDocumentacion(idIncapacidad);
      if (!verificacion) throw new ErrorDeValidacion({ incapacidad: 'No hay una incapacidad con ese número.' });
      const { incapacidad, aviso } = verificacion;
      if (!aviso?.pendiente) {
        throw new ErrorDeValidacion({
          llamado: 'No hay un aviso de faltantes pendiente: el segundo llamado se registra cuando el colaborador no entregó lo que se le pidió.',
        });
      }
      if (aviso.segundoLlamado) {
        throw new ErrorDeValidacion({ llamado: 'El segundo llamado de este aviso ya se registró y la Coordinación ya fue avisada.' });
      }
      if (!aviso.vencido) {
        throw new ErrorDeValidacion({
          llamado: `El colaborador tiene plazo hasta el ${fechaLarga(aviso.fechaLimite)}. Podrá registrar el segundo llamado desde el ${fechaLarga(aviso.fechaSegundoLlamado)}.`,
        });
      }

      try {
        await correo.notificarCitacion(
          { ...incapacidad, faltantes: aviso.faltantes.map((t) => NOMBRES_TIPO_DOCUMENTO[t] ?? t) },
          { fechaAviso: fechaLarga(aviso.fechaAviso), fechaLimite: fechaLarga(aviso.fechaLimite) },
        );
      } catch (error) {
        console.error('No se pudo enviar notificarCitacion:', error);
        throw new ErrorDeValidacion({
          correo: 'No se pudo enviar el correo a la Coordinación, así que el segundo llamado no se registró. Intente de nuevo.',
        });
      }
      const guardado = await baseDeDatos.guardarSegundoLlamado(incapacidad.idIncapacidad, aviso.fechaAviso);
      if (!guardado) {
        throw new ErrorDeValidacion({ llamado: 'Otro usuario registró el segundo llamado o el aviso cambió al mismo tiempo. Revise el resultado.' });
      }
      return { idIncapacidad: incapacidad.idIncapacidad };
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
