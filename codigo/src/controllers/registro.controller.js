// Grupo `registro` del Control de incapacidades — DS-01 (CU-01, CU-02).
// Operaciones: registrarIncapacidad, registrarDocumentos.
// Apoyo: obtenerEntidades, para que el formulario ofrezca las entidades del seed (DA-03),
// y obtenerIncapacidad, para mostrar a cuál se le van a registrar los documentos.
import { z } from 'zod';
import { TIPOS_DOCUMENTO } from '../models/documento.model.js';
import { TIPOS_INCAPACIDAD } from '../models/incapacidad.model.js';
import { TAMANO_MAXIMO_ARCHIVO, tipoDeArchivo } from './archivo.js';
import { ErrorDeValidacion } from './error-de-validacion.js';
import { diasDelCaso } from './hitos.js';
import { esIdentificador } from './identificador.js';
import { fechaBreve, hoyEnColombia, sumarIntervalo } from '../servicios/dias-habiles.js';

const fecha = (mensaje) => z.string({ error: mensaje }).pipe(z.iso.date({ error: mensaje }));

// Contenido mínimo del registro (CU-01, HU-03.CA1) + correo del colaborador (DA-04).
// El IBC no se pide aquí: se ingresa al calcular el reconocimiento (HU-21.CA3).
const datosDeIncapacidad = z.object({
  colaborador: z
    .string({ error: 'Escriba el nombre del colaborador.' })
    .trim()
    .min(1, 'Escriba el nombre del colaborador.')
    .max(200, 'El nombre es demasiado largo.'),
  correoColaborador: z
    .string({ error: 'Escriba el correo del colaborador.' })
    .trim()
    .toLowerCase()
    .max(200, 'El correo es demasiado largo.')
    .pipe(z.email({ error: 'Escriba un correo válido, por ejemplo nombre@empresa.com.' })),
  tipo: z.enum(TIPOS_INCAPACIDAD, { error: 'Elija el tipo de incapacidad o licencia.' }),
  entidad: z.coerce
    .number({ error: 'Elija la entidad (EPS o ARL).' })
    .int('Elija la entidad (EPS o ARL).')
    .positive('Elija la entidad (EPS o ARL).'),
  fechaInicio: fecha('Escriba la fecha de inicio.'),
  // El tope es técnico (cabe en un entero de la base de datos), no una regla del negocio.
  diasIncapacidad: z.coerce
    .number({ error: 'Escriba los días de incapacidad.' })
    .int('Los días deben ser un número entero.')
    .min(1, 'Los días deben ser 1 o más.')
    .max(9999, 'Revise los días de incapacidad.'),
  fechaRecepcion: fecha('Escriba la fecha de recepción.'),
  // HU-12: solo en las licencias (se valida aparte); vacía = sin escribir.
  fechaNacimiento: z.preprocess((v) => (v === '' ? undefined : v), fecha('Escriba la fecha de nacimiento.').optional()),
  // Casilla «Usar el nombre guardado» (decisión 1A): presente = marcada.
  usarNombreGuardado: z.preprocess((v) => v != null && v !== '' && v !== false, z.boolean()),
});

// DA-50: lo que se escribe de una prórroga; colaborador, tipo y entidad salen de la anterior.
const datosDeProrroga = datosDeIncapacidad.pick({ fechaInicio: true, diasIncapacidad: true, fechaRecepcion: true });

// HU-03 (auditoría): la fecha de inicio no puede ser anterior a hoy − 3 años: el derecho a pedir el reembolso a la
// EPS o la ARL prescribe a los 3 años (Ley 1438 de 2011, art. 28) y es también el plazo más largo de transcripción
// (Sanitas, §5.2.1). Como la recepción no puede ser futura ni anterior al inicio, el inicio tampoco es futuro.
export const ANIOS_ATRAS_INICIO = 3;

/** Errores de las fechas de recepción e inicio (HU-03), por campo. `hoy` = AAAA-MM-DD en Colombia. */
export function erroresDeFechas({ fechaInicio, fechaRecepcion }, hoy) {
  const errores = {};
  const limite = sumarIntervalo(hoy, { anios: -ANIOS_ATRAS_INICIO });
  if (fechaInicio < limite) {
    errores.fechaInicio = `La fecha de inicio no puede ser anterior al ${fechaBreve(limite)}: después de ${ANIOS_ATRAS_INICIO} años ya no se puede cobrar.`;
  }
  if (fechaRecepcion > hoy) errores.fechaRecepcion = 'La fecha de recepción no puede ser posterior a hoy.';
  else if (fechaRecepcion < fechaInicio) errores.fechaRecepcion = 'La fecha de recepción no puede ser anterior a la fecha de inicio.';
  return errores;
}

// HU-03 (auditoría): accidente y enfermedad laboral se tramitan ante la ARL; los demás tipos, ante la EPS.
const TIPOS_ARL = new Set(['accidente_laboral', 'enfermedad_laboral']);
export const tipoDeEntidadPara = (tipo) => (TIPOS_ARL.has(tipo) ? 'ARL' : 'EPS');
const mensajeTipoEntidad = (tipo) =>
  tipoDeEntidadPara(tipo) === 'ARL'
    ? 'Un accidente o una enfermedad laboral se tramita ante la ARL: elija una ARL.'
    : 'Este tipo se tramita ante la EPS: elija una EPS (las ARL solo reciben lo laboral).';

// HU-12 (auditoría, Ley 2114 de 2021): ventana de la fecha de inicio de una licencia respecto del nacimiento.
export const DIAS_PATERNIDAD_DESDE_NACIMIENTO = 30;
export const DIAS_PREPARTO = 14;
export const LICENCIAS = new Set(['licencia_maternidad', 'licencia_paternidad']);

/** Error de la fecha de nacimiento de una licencia (HU-12), o null si está bien o no es una licencia. */
export function errorDeNacimiento({ tipo, fechaInicio, fechaNacimiento }, hoy) {
  if (!LICENCIAS.has(tipo)) return null;
  if (!fechaNacimiento) return 'Escriba la fecha de nacimiento (está en el certificado de nacido vivo).';
  if (fechaNacimiento > hoy) return 'La fecha de nacimiento no puede ser posterior a hoy.';
  const [desde, hasta, regla] =
    tipo === 'licencia_paternidad'
      ? [fechaNacimiento, sumarIntervalo(fechaNacimiento, { dias: DIAS_PATERNIDAD_DESDE_NACIMIENTO }), 'entre el nacimiento y 30 días después']
      : [sumarIntervalo(fechaNacimiento, { dias: -DIAS_PREPARTO }), fechaNacimiento, 'entre 2 semanas antes del nacimiento y el día del nacimiento'];
  if (fechaInicio < desde || fechaInicio > hasta) {
    const nombre = tipo === 'licencia_paternidad' ? 'paternidad' : 'maternidad';
    return `La licencia de ${nombre} empieza ${regla} (del ${fechaBreve(desde)} al ${fechaBreve(hasta)}): revise esta fecha o la de inicio.`;
  }
  return null;
}

/** Mismo nombre = igual sin contar mayúsculas ni espacios repetidos o en los extremos (como la función SQL). */
export const mismoNombre = (a, b) => {
  const normal = (t) => String(t).trim().replace(/\s+/g, ' ').toLocaleLowerCase('es');
  return normal(a) === normal(b);
};
const mensajeNombreGuardado = (nombre) =>
  `Ese correo ya es de «${nombre}». Si es la misma persona, marque «Usar el nombre guardado»; si no, revise el correo.`;
const mensajeDuplicada = (id) =>
  `Ya está registrada la incapacidad n.º ${id} de este colaborador, con el mismo tipo y las mismas fechas: no se registra dos veces.`;

// DA-50 (Decreto 1427 de 2022): prórroga = sin interrupción mayor a 30 días; las licencias no se prorrogan.
export const INTERRUPCION_MAXIMA = 30;
const MENSAJES_PRORROGA = Object.freeze({
  tieneProrroga: (a) => `La incapacidad n.º ${a.idIncapacidad} ya tiene su prórroga (n.º ${a.prorroga}): registre la nueva como prórroga de esa.`,
  licencia: 'Una licencia de maternidad o paternidad no tiene prórroga.',
  fecha: (a) =>
    `La prórroga debe empezar entre el ${fechaBreve(a.fechaSugerida)} (día siguiente al fin de la anterior) y el ${fechaBreve(a.fechaMaxima)} (${INTERRUPCION_MAXIMA} días después).`,
});

/** La anterior de una prórroga, con su fin y el rango de fechas en que puede empezar la prórroga (DA-50). */
function conVentana(anterior) {
  const fechaFin = sumarIntervalo(anterior.fechaInicio, { dias: anterior.diasIncapacidad - 1 });
  return {
    ...anterior,
    fechaFin,
    diasCaso: diasDelCaso(anterior),
    fechaSugerida: sumarIntervalo(fechaFin, { dias: 1 }),
    fechaMaxima: sumarIntervalo(fechaFin, { dias: INTERRUPCION_MAXIMA + 1 }),
  };
}

/** Por qué no se le puede registrar una prórroga a la anterior, o null si se puede. */
const impedimentoDeProrroga = (a) => (a.tieneProrroga ? MENSAJES_PRORROGA.tieneProrroga(a) : LICENCIAS.has(a.tipo) ? MENSAJES_PRORROGA.licencia : null);

// Límites de la subida (el tamaño es el del bucket `documentos`; ver archivo.js).
export { TAMANO_MAXIMO_ARCHIVO };
export const MAXIMO_DOCUMENTOS = 10;

export const MENSAJE_EPICRISIS_ARCHIVADA =
  'La epicrisis de esta incapacidad se eliminó al preparar el archivo: no se registra una nueva (CAR-11).';

export function crearControlRegistro({ baseDeDatos, correo, hoy = hoyEnColombia }) {
  /** Errores por campo para un rechazo de `registrar_incapacidad`, o null si el error es otro. */
  const explicarRechazo = async (error, datos) => {
    switch (error?.code) {
      case 'SG020': {
        const guardado = await baseDeDatos.consultarColaboradorPorCorreo(datos.correoColaborador);
        return { colaborador: mensajeNombreGuardado(guardado?.nombre ?? ''), nombreGuardado: guardado?.nombre ?? '' };
      }
      case 'SG021':
        return { entidad: mensajeTipoEntidad(datos.tipo) };
      case 'SG022':
        return { fechaRecepcion: 'Revise las fechas: la recepción no puede ser futura ni anterior al inicio.' };
      case 'SG023':
        return { fechaNacimiento: 'Revise la fecha de nacimiento: no puede ser futura y debe corresponder al inicio de la licencia.' };
      case '23505': {
        const id = await baseDeDatos.buscarIncapacidadDuplicada({ correo: datos.correoColaborador, ...datos });
        return { duplicada: mensajeDuplicada(id ?? '') };
      }
      default:
        return null;
    }
  };

  return {
    /** Entidades (EPS y ARL) entre las que se elige al registrar (DA-03). */
    obtenerEntidades() {
      return baseDeDatos.consultarEntidades();
    },

    /**
     * DS-01: registrarIncapacidad(colaborador, tipo, entidad, fechaInicio, dias, fechaRecepcion).
     * Crea el colaborador si no existe (DA-03) y guarda quién registró (DA-23).
     * La incapacidad queda sin estado: «registrada, sin transcribir» (HU-03.CA4, EST-01).
     * Auditoría: fechas en rango, tipo coherente con la entidad, fecha de nacimiento de las licencias (HU-12), sin
     * duplicados y, si el correo ya es de otro nombre, se pide confirmar que es la misma persona (decisión 1A). La
     * base vuelve a comprobarlo todo en la misma transacción (registro_validaciones).
     * @returns {Promise<{ idIncapacidad: number }>}
     * @throws {ErrorDeValidacion} por campo; `nombreGuardado` acompaña al error del colaborador y `duplicada`, a la
     *   incapacidad que ya existe.
     */
    async registrarIncapacidad(datos, usuario) {
      const fechaHoy = hoy();
      const resultado = datosDeIncapacidad.safeParse(datos ?? {});
      const errores = {};
      if (!resultado.success) {
        for (const problema of resultado.error.issues) errores[problema.path[0]] ??= problema.message;
      } else {
        const d = resultado.data;
        const entidad = (await baseDeDatos.consultarEntidades()).find((e) => e.id === d.entidad);
        if (!entidad) errores.entidad = 'Elija una entidad de la lista.';
        else if (entidad.tipo !== tipoDeEntidadPara(d.tipo)) errores.entidad = mensajeTipoEntidad(d.tipo);
        Object.assign(errores, erroresDeFechas(d, fechaHoy));
        const nacimiento = errorDeNacimiento(d, fechaHoy);
        if (nacimiento) errores.fechaNacimiento = nacimiento;
      }
      if (Object.keys(errores).length > 0) throw new ErrorDeValidacion(errores);

      const { colaborador, correoColaborador, entidad, usarNombreGuardado, fechaNacimiento, ...resto } = resultado.data;
      const guardado = await baseDeDatos.consultarColaboradorPorCorreo(correoColaborador);
      const mismo = guardado != null && mismoNombre(guardado.nombre, colaborador);
      if (guardado && !mismo && !usarNombreGuardado) {
        errores.colaborador = mensajeNombreGuardado(guardado.nombre);
        errores.nombreGuardado = guardado.nombre;
      }
      const duplicada = await baseDeDatos.buscarIncapacidadDuplicada({ correo: correoColaborador, ...resto });
      if (duplicada != null) errores.duplicada = mensajeDuplicada(duplicada);
      if (Object.keys(errores).length > 0) throw new ErrorDeValidacion(errores);

      try {
        const idIncapacidad = await baseDeDatos.guardarIncapacidad(
          {
            colaborador: { nombre: guardado?.nombre ?? colaborador, correo: correoColaborador },
            entidad,
            ...resto,
            fechaNacimiento: LICENCIAS.has(resto.tipo) ? fechaNacimiento : null,
            nombreConfirmado: guardado != null,
          },
          usuario.id,
        );
        return { idIncapacidad };
      } catch (error) {
        // Otro registro se cruzó entre la consulta y el guardado (o la hora cambió de día): se explica con lo de ahora.
        const rechazo = await explicarRechazo(error, { correoColaborador, ...resto });
        if (rechazo) throw new ErrorDeValidacion(rechazo);
        throw error;
      }
    },

    /**
     * DA-50: la incapacidad que se va a prorrogar, con el rango de fechas en que puede empezar la prórroga y, si no se
     * puede prorrogar, por qué (`impedimento`). null si el número no corresponde a ninguna.
     */
    async prepararProrroga(idAnterior) {
      const anterior = esIdentificador(idAnterior) ? await baseDeDatos.obtenerParaProrroga(Number(idAnterior)) : null;
      if (!anterior) return null;
      const datos = conVentana(anterior);
      return { anterior: datos, impedimento: impedimentoDeProrroga(datos) };
    },

    /**
     * DS-01: registrarIncapacidad de una prórroga (DA-50). Colaborador, tipo y entidad son los de la anterior; se
     * escriben la fecha de inicio, los días y la fecha de recepción. Reglas: la anterior no tiene prórroga ni es una
     * licencia, y la prórroga empieza entre el día siguiente al fin de la anterior y 30 días después. La base las
     * vuelve a comprobar con la anterior bloqueada (dos prórrogas a la vez de la misma no se cruzan).
     * @returns {Promise<null | { idIncapacidad: number }>} null si la anterior no existe.
     * @throws {ErrorDeValidacion} datos no válidos (por campo) o la anterior no admite prórroga (`anterior`).
     */
    async registrarProrroga(idAnterior, datos, usuario) {
      const preparada = await this.prepararProrroga(idAnterior);
      if (!preparada) return null;
      const { anterior, impedimento } = preparada;
      if (impedimento) throw new ErrorDeValidacion({ anterior: impedimento });

      const resultado = datosDeProrroga.safeParse(datos ?? {});
      const errores = {};
      if (!resultado.success) {
        for (const problema of resultado.error.issues) errores[problema.path[0]] ??= problema.message;
      } else {
        if (resultado.data.fechaInicio < anterior.fechaSugerida || resultado.data.fechaInicio > anterior.fechaMaxima) {
          errores.fechaInicio = MENSAJES_PRORROGA.fecha(anterior);
        }
        // HU-03 (auditoría): la recepción tampoco puede ser futura ni anterior al inicio de la prórroga.
        const { fechaRecepcion } = erroresDeFechas(resultado.data, hoy());
        if (fechaRecepcion) errores.fechaRecepcion = fechaRecepcion;
      }
      if (Object.keys(errores).length > 0) throw new ErrorDeValidacion(errores);

      const guardada = await baseDeDatos.guardarProrroga(anterior.idIncapacidad, resultado.data, usuario.id);
      if (guardada.rechazo) {
        // Otro usuario se adelantó o cambió la anterior: se explica con lo que hay ahora.
        const ahora = await this.prepararProrroga(anterior.idIncapacidad);
        throw new ErrorDeValidacion(
          ahora?.impedimento ? { anterior: ahora.impedimento } : { fechaInicio: MENSAJES_PRORROGA.fecha(ahora?.anterior ?? anterior) },
        );
      }
      return { idIncapacidad: guardada.id };
    },

    /** Datos que identifican la incapacidad, o null si el número no corresponde a ninguna. */
    async obtenerIncapacidad(idIncapacidad) {
      return esIdentificador(idIncapacidad) ? baseDeDatos.consultarIncapacidad(Number(idIncapacidad)) : null;
    },

    /**
     * DS-01: registrarDocumentos(idIncapacidad, documentos).
     * `documentos` es una lista de { tipo, contenido: Buffer }.
     * - Recepción (personal receptor): guarda, da el original en físico por recibido y avisa al auxiliar (HU-04.CA1).
     * - Correo (auxiliar): guarda y marca el original en físico como pendiente, sin aviso (HU-04.CA2).
     * El canal sale del rol: en DA-02 el auxiliar solo registra documentos cuando llegan por correo.
     * @returns {Promise<{ idIncapacidad: number, cantidad: number, originalPendiente: boolean, avisoEnviado: boolean }>}
     */
    async registrarDocumentos(idIncapacidad, documentos, usuario) {
      const incapacidad = await this.obtenerIncapacidad(idIncapacidad);
      if (!incapacidad) throw new ErrorDeValidacion({ incapacidad: 'No hay una incapacidad con ese número.' });

      const lista = Array.isArray(documentos) ? documentos : [];
      const errores = {};
      if (lista.length === 0) errores.documentos = 'Adjunte al menos un documento.';
      else if (lista.length > MAXIMO_DOCUMENTOS) errores.documentos = `Adjunte máximo ${MAXIMO_DOCUMENTOS} documentos a la vez.`;

      const validos = [];
      lista.forEach((documento, posicion) => {
        const contenido = documento?.contenido;
        const tipoMime = Buffer.isBuffer(contenido) ? tipoDeArchivo(contenido) : null;
        const clave = `documento${posicion}`;
        if (!TIPOS_DOCUMENTO.includes(documento?.tipo)) errores[clave] = 'Elija el tipo de documento.';
        else if (!Buffer.isBuffer(contenido) || contenido.length === 0) errores[clave] = 'Adjunte el archivo.';
        else if (contenido.length > TAMANO_MAXIMO_ARCHIVO) errores[clave] = 'El archivo pesa más de 10 MB.';
        else if (!tipoMime) errores[clave] = 'El archivo debe ser PDF, JPG o PNG.';
        else validos.push({ tipo: documento.tipo, contenido, tipoMime });
      });
      // CAR-11, DA-59: la epicrisis se elimina al archivar; no se vuelve a recibir, ni aunque se deshaga la preparación.
      if (incapacidad.archivoPreparado || incapacidad.epicrisisEliminada) {
        lista.forEach((documento, posicion) => {
          if (documento?.tipo === 'epicrisis' && !errores[`documento${posicion}`]) errores[`documento${posicion}`] = MENSAJE_EPICRISIS_ARCHIVADA;
        });
      }
      if (Object.keys(errores).length > 0) throw new ErrorDeValidacion(errores);

      // Por correo, los documentos y la marca de original pendiente se guardan juntos o no se guarda nada.
      const porCorreo = usuario.rol === 'auxiliar';
      await baseDeDatos.guardarDocumentos(incapacidad.idIncapacidad, validos, usuario.id, { originalPendiente: porCorreo });

      let avisoEnviado = false;
      if (!porCorreo) {
        // Los documentos ya quedaron guardados: si el correo falla, se advierte y no se pierde el registro.
        try {
          await correo.notificarRecepcion(incapacidad);
          avisoEnviado = true;
        } catch (error) {
          console.error('No se pudo enviar notificarRecepcion:', error);
        }
      }
      return { idIncapacidad: incapacidad.idIncapacidad, cantidad: validos.length, originalPendiente: porCorreo, avisoEnviado };
    },
  };
}
