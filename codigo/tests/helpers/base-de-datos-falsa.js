// Persistencia falsa en memoria para las pruebas unitarias y HTTP: no usa Supabase.
import { diasDelCaso, fechasDelCaso, llegoAlDia } from '../../src/controllers/hitos.js';
import { sumarIntervalo } from '../../src/servicios/dias-habiles.js';
export const ENTIDADES = Object.freeze([
  { id: 1, nombre: 'ARL SURA', tipo: 'ARL' },
  { id: 2, nombre: 'Nueva EPS', tipo: 'EPS' },
  { id: 3, nombre: 'Sanitas', tipo: 'EPS' },
  { id: 4, nombre: 'Salud Total', tipo: 'EPS' },
]);

// Plazos de transcripción como los entrega Supabase (seed, §5.2.1): `interval` en texto.
const PLAZOS = Object.freeze({
  1: { plazoTranscripcion: '1 year', plazoTranscripcionTransito: null, permiteTranscripcionDigital: true },
  2: { plazoTranscripcion: '1 year', plazoTranscripcionTransito: null, permiteTranscripcionDigital: true },
  3: { plazoTranscripcion: '3 years', plazoTranscripcionTransito: null, permiteTranscripcionDigital: false },
  4: { plazoTranscripcion: '1 year', plazoTranscripcionTransito: '15 days', permiteTranscripcionDigital: true },
});

const EXTENSIONES = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

function cumpleFiltros(i, { estado, entidad, colaboradores, desde, hasta }) {
  if (estado === 'registrada' ? i.estado != null : estado && i.estado !== estado) return false;
  if (entidad && i.entidad !== entidad) return false;
  if (colaboradores && !colaboradores.includes(i.colaboradorId)) return false;
  if (desde && i.fechaInicio < desde) return false;
  if (hasta && i.fechaInicio > hasta) return false;
  return true;
}

// Condición del día N en la base (hitos.js, DA-49, DA-50): `fecha_dia_N <= hoy` en el certificado vigente del caso.
const cumpleDia = (i, dia) => !i.tieneProrroga && llegoAlDia(i, dia.n, dia.hoy);

// Los datos del caso de una incapacidad guardada (como aCaso de caso.js; DA-50).
const datosDelCaso = (i) => ({
  prorrogaDe: i.prorrogaDe ?? null,
  casoId: i.casoId ?? i.idIncapacidad,
  diasPrevios: i.diasPrevios ?? 0,
  diasAcumulados: (i.diasPrevios ?? 0) + i.diasIncapacidad,
  tieneProrroga: i.tieneProrroga ?? false,
  ...(i.fechasDia ? { fechasDia: i.fechasDia } : {}),
});

export function crearBaseDeDatosFalsa() {
  const colaboradores = [];
  const incapacidades = [];
  const documentos = [];
  const reemplazos = []; // máximo uno por incapacidad, como el índice único de la tabla
  const radicaciones = [];
  const pagos = [];
  const seguimientos = [];
  const acuerdos = [];
  const requerimientos = [];
  const pagosConsignados = [];
  const conciliaciones = [];
  const reportes = [];
  const nombreEntidad = (id) => ENTIDADES.find((e) => e.id === id).nombre;
  const datosArchivo = (i) => ({
    idIncapacidad: i.idIncapacidad,
    colaborador: colaboradores.find((c) => c.id === i.colaboradorId).nombre,
    entidad: nombreEntidad(i.entidad),
    tipo: i.tipo,
    fechaInicio: i.fechaInicio,
    diasIncapacidad: i.diasIncapacidad,
    estado: i.estado,
    enviadaAGestionDocumental: i.enviadaAGestionDocumental ?? false,
    fechaArchivoPreparado: i.fechaArchivoPreparado ?? null,
    fechaEnvioArchivo: i.fechaEnvioArchivo ?? null,
    // Como el embed usuario!incapacidad_envio_archivo_por_fkey(correo): las pruebas usan ids `id-<rol>`.
    envioArchivoPor: i.envioArchivoPor ? `${i.envioArchivoPor.replace(/^id-/, '')}@sigi.test` : null,
    pagos: pagos
      .filter((p) => p.idIncapacidad === i.idIncapacidad)
      .sort((a, b) => a.fechaPago.localeCompare(b.fechaPago) || a.idPago - b.idPago)
      .map(({ idPago, valor, fechaPago, conciliado }) => ({ idPago, valor, fechaPago, conciliado })),
    documentos: documentos.filter((d) => d.idIncapacidad === i.idIncapacidad).map(({ idDocumento, tipo }) => ({ idDocumento, tipo })),
  });
  // Como registrar_conciliacion (DA-56): comprueba que lo comparado sigue igual y lo guarda todo junto.
  const registrarConciliacion = (entidadId, { consignadosVistos, pares, detalle, saldos }, por) => {
    const pendientes = pagosConsignados.filter((p) => p.entidadId === entidadId && p.conciliacionId == null).map((p) => p.id).sort((a, b) => a - b);
    if (JSON.stringify(pendientes) !== JSON.stringify([...consignadosVistos].sort((a, b) => a - b))) return null;
    const libres = pares.every(({ consignado, pago }) => {
      const p = pagos.find((x) => x.idPago === pago);
      const i = p && incapacidades.find((x) => x.idIncapacidad === p.idIncapacidad);
      return consignadosVistos.includes(consignado) && p && !p.conciliado && i.entidad === entidadId;
    });
    if (!libres) return null;
    const id = conciliaciones.length + 1;
    conciliaciones.push({ id, entidadId, detalle, saldosPendientes: saldos, creadoPor: por, creadoEn: new Date().toISOString() });
    for (const { consignado, pago } of pares) {
      pagosConsignados.find((p) => p.id === consignado).conciliacionId = id;
      Object.assign(pagos.find((p) => p.idPago === pago), { conciliado: true, conciliacionId: id });
    }
    return id;
  };
  return {
    reportes,
    pagosConsignados,
    conciliaciones,
    radicaciones,
    pagos,
    seguimientos,
    acuerdos,
    requerimientos,
    colaboradores,
    incapacidades,
    documentos,
    reemplazos,
    async consultarEntidades() {
      return [...ENTIDADES];
    },
    async guardarIncapacidad({ colaborador, ...datos }, creadoPor) {
      let guardado = colaboradores.find((c) => c.correo === colaborador.correo);
      if (!guardado) {
        guardado = { id: colaboradores.length + 1, ...colaborador, creadoPor };
        colaboradores.push(guardado);
      }
      const idIncapacidad = incapacidades.length + 1;
      // estado: null, como el valor por defecto de la tabla (EST-01).
      incapacidades.push({ idIncapacidad, colaboradorId: guardado.id, ...datos, estado: null, creadoPor });
      return idIncapacidad;
    },
    // DA-50: como registro.persistence.js y la función registrar_prorroga (reglas y derivados del trigger).
    async obtenerParaProrroga(idIncapacidad) {
      const i = incapacidades.find((x) => x.idIncapacidad === idIncapacidad);
      if (!i) return null;
      return {
        idIncapacidad,
        colaborador: colaboradores.find((c) => c.id === i.colaboradorId).nombre,
        tipo: i.tipo,
        entidad: ENTIDADES.find((e) => e.id === i.entidad).nombre,
        fechaInicio: i.fechaInicio,
        diasIncapacidad: i.diasIncapacidad,
        ...datosDelCaso(i),
        ...(i.tieneProrroga ? { prorroga: incapacidades.find((x) => x.prorrogaDe === idIncapacidad)?.idIncapacidad ?? null } : {}),
      };
    },
    async guardarProrroga(idAnterior, { fechaInicio, diasIncapacidad, fechaRecepcion }, creadoPor) {
      const a = incapacidades.find((x) => x.idIncapacidad === idAnterior);
      if (!a) return { rechazo: 'SG010' };
      if (a.tieneProrroga) return { rechazo: 'SG011' };
      if (a.tipo.startsWith('licencia_')) return { rechazo: 'SG012' };
      const fin = sumarIntervalo(a.fechaInicio, { dias: a.diasIncapacidad - 1 });
      if (fechaInicio <= fin || fechaInicio > sumarIntervalo(fin, { dias: 31 })) return { rechazo: 'SG013' };
      const idIncapacidad = incapacidades.length + 1;
      const diasPrevios = (a.diasPrevios ?? 0) + a.diasIncapacidad;
      incapacidades.push({
        idIncapacidad, colaboradorId: a.colaboradorId, entidad: a.entidad, tipo: a.tipo, fechaInicio, diasIncapacidad, fechaRecepcion,
        estado: null, creadoPor, prorrogaDe: idAnterior, casoId: a.casoId ?? a.idIncapacidad, diasPrevios,
        fechasDia: fechasDelCaso({ fechaInicio, diasIncapacidad, diasPrevios }, a.fechasDia ?? fechasDelCaso(a)),
        // El monitoreo pasa a la prórroga (como el trigger).
        concepto: a.concepto, faltaConcepto: a.faltaConcepto, pagoSuspendido: a.pagoSuspendido,
        fechaConcepto: a.fechaConcepto, fechaFaltaConcepto: a.fechaFaltaConcepto, fechaSuspension: a.fechaSuspension,
      });
      a.tieneProrroga = true;
      return { id: idIncapacidad };
    },
    async consultarIncapacidad(idIncapacidad) {
      const guardada = incapacidades.find((i) => i.idIncapacidad === idIncapacidad);
      if (!guardada) return null;
      const colaborador = colaboradores.find((c) => c.id === guardada.colaboradorId);
      return {
        idIncapacidad,
        colaborador: colaborador.nombre,
        correoColaborador: colaborador.correo,
        tipo: guardada.tipo,
        entidad: ENTIDADES.find((e) => e.id === guardada.entidad).nombre,
        fechaInicio: guardada.fechaInicio,
        diasIncapacidad: guardada.diasIncapacidad,
        originalPendiente: guardada.originalPendiente ?? false,
        archivoPreparado: guardada.fechaArchivoPreparado != null,
      };
    },
    async guardarDocumentos(idIncapacidad, nuevos, creadoPor, { originalPendiente = false } = {}) {
      const guardados = nuevos.map(({ tipo, contenido, tipoMime }, i) => ({
        idDocumento: documentos.length + i + 1,
        idIncapacidad,
        tipo,
        archivo: `incapacidades/${idIncapacidad}/${tipo}-${documentos.length + i + 1}.${EXTENSIONES[tipoMime]}`,
        tipoMime,
        tamano: contenido.length,
        contenido,
        creadoPor,
      }));
      documentos.push(...guardados);
      const incapacidad = incapacidades.find((i) => i.idIncapacidad === idIncapacidad);
      if (originalPendiente) incapacidad.originalPendiente = true;
      // Como registrar_documentos: vuelve a quedar lista para verificarse (HU-07.CA2, DA-29).
      Object.assign(incapacidad, { documentacionCompleta: null, archivadoDigital: false });
      return guardados.map(({ tipo, archivo }) => ({ tipo, archivo }));
    },
    async obtenerExpediente(idIncapacidad) {
      const datos = await this.consultarIncapacidad(idIncapacidad);
      if (!datos) return null;
      const guardada = incapacidades.find((i) => i.idIncapacidad === idIncapacidad);
      return {
        ...datos,
        documentacionCompleta: guardada.documentacionCompleta ?? null,
        archivadoDigital: guardada.archivadoDigital ?? false,
        faltantes: guardada.faltantes ?? [],
        fechaAvisoFaltantes: guardada.fechaAvisoFaltantes ?? null,
        segundoLlamado: guardada.segundoLlamado ?? false,
        documentos: documentos.filter((d) => d.idIncapacidad === idIncapacidad).map(({ idDocumento, tipo }) => ({ idDocumento, tipo })),
      };
    },
    async archivarDigital(idIncapacidad) {
      Object.assign(incapacidades.find((i) => i.idIncapacidad === idIncapacidad), { documentacionCompleta: true, archivadoDigital: true });
    },
    async guardarFaltantes(idIncapacidad, faltantes, fechaAviso) {
      const incapacidad = incapacidades.find((i) => i.idIncapacidad === idIncapacidad);
      if (!incapacidad || incapacidad.documentacionCompleta === false) return false;
      Object.assign(incapacidad, { faltantes, fechaAvisoFaltantes: fechaAviso, documentacionCompleta: false, segundoLlamado: false });
      return true;
    },
    async guardarSegundoLlamado(idIncapacidad, fechaAviso) {
      const incapacidad = incapacidades.find((i) => i.idIncapacidad === idIncapacidad);
      const pendiente = incapacidad?.documentacionCompleta === false && incapacidad.fechaAvisoFaltantes === fechaAviso;
      if (!pendiente || incapacidad.segundoLlamado) return false;
      incapacidad.segundoLlamado = true;
      return true;
    },
    async obtenerDatosRadicacion(idIncapacidad) {
      const guardada = incapacidades.find((i) => i.idIncapacidad === idIncapacidad);
      if (!guardada) return null;
      const { id, ...entidad } = ENTIDADES.find((e) => e.id === guardada.entidad);
      return {
        idIncapacidad,
        colaborador: colaboradores.find((c) => c.id === guardada.colaboradorId).nombre,
        tipo: guardada.tipo,
        fechaInicio: guardada.fechaInicio,
        diasIncapacidad: guardada.diasIncapacidad,
        fechaRecepcion: guardada.fechaRecepcion,
        fechaNacimiento: guardada.fechaNacimiento ?? null,
        estado: guardada.estado,
        causalRechazo: guardada.causalRechazo ?? null,
        fechaRechazo: guardada.fechaRechazo ?? null,
        documentacionCompleta: guardada.documentacionCompleta ?? null,
        archivadoDigital: guardada.archivadoDigital ?? false,
        entidad: { ...entidad, ...PLAZOS[id] },
        radicaciones: radicaciones
          .filter((r) => r.idIncapacidad === idIncapacidad)
          .map(({ idRadicacion, radicado, evidencia, fecha }) => ({ idRadicacion, radicado, conEvidencia: Boolean(evidencia), fecha })),
      };
    },
    // Como registrar_radicacion: solo desde registrada (null) o rechazada; guarda y pone transcrita.
    async guardarRadicacion(idIncapacidad, { radicado, contenido, tipoMime }, creadoPor) {
      const incapacidad = incapacidades.find((i) => i.idIncapacidad === idIncapacidad);
      if (!incapacidad || !(incapacidad.estado == null || incapacidad.estado === 'rechazada')) return null;
      const idRadicacion = radicaciones.length + 1;
      radicaciones.push({
        idRadicacion,
        idIncapacidad,
        radicado,
        evidencia: `incapacidades/${idIncapacidad}/radicacion-${idRadicacion}.${EXTENSIONES[tipoMime]}`,
        contenido,
        tipoMime,
        creadoPor,
        fecha: new Date(Date.UTC(2026, 10, 19, 15, idRadicacion)).toISOString(),
      });
      incapacidad.estado = 'transcrita';
      return idRadicacion;
    },
    async obtenerDatosCobro(idIncapacidad) {
      const guardada = incapacidades.find((i) => i.idIncapacidad === idIncapacidad);
      if (!guardada) return null;
      return {
        idIncapacidad,
        colaborador: colaboradores.find((c) => c.id === guardada.colaboradorId).nombre,
        entidad: ENTIDADES.find((e) => e.id === guardada.entidad).nombre,
        tipo: guardada.tipo,
        fechaInicio: guardada.fechaInicio,
        diasIncapacidad: guardada.diasIncapacidad,
        estado: guardada.estado,
        causalRechazo: guardada.causalRechazo ?? null,
        fechaRechazo: guardada.fechaRechazo ?? null,
        tiempoPago: guardada.tiempoPago ?? null,
        fechaCobrada: guardada.fechaCobrada ?? null,
        archivoPreparado: guardada.fechaArchivoPreparado != null,
        radicaciones: radicaciones
          .filter((r) => r.idIncapacidad === idIncapacidad)
          .map(({ idRadicacion, radicado, evidencia, fecha }) => ({ idRadicacion, radicado, conEvidencia: Boolean(evidencia), fecha })),
        pagos: pagos
          .filter((p) => p.idIncapacidad === idIncapacidad)
          .map(({ idPago, valor, fechaPago }) => ({ idPago, valor, fechaPago })),
      };
    },
    // Como registrar_pago: solo desde cobrada o pagada y sin el archivo preparado (DA-59); guarda el pago y pone pagada (DA-08).
    async guardarPago(idIncapacidad, { valor, fechaPago }, creadoPor) {
      const incapacidad = incapacidades.find((i) => i.idIncapacidad === idIncapacidad);
      if (!incapacidad || !['cobrada', 'pagada'].includes(incapacidad.estado) || incapacidad.fechaArchivoPreparado != null) return null;
      const idPago = pagos.length + 1;
      pagos.push({ idPago, idIncapacidad, valor, fechaPago, conciliado: false, creadoPor });
      incapacidad.estado = 'pagada';
      return idPago;
    },
    // Como el UPDATE condicionado de guardarCobrada: solo desde transcrita.
    async guardarCobrada(idIncapacidad, { tiempoPago, fechaCobrada }) {
      const incapacidad = incapacidades.find((i) => i.idIncapacidad === idIncapacidad);
      if (incapacidad?.estado !== 'transcrita') return false;
      Object.assign(incapacidad, { estado: 'cobrada', tiempoPago, fechaCobrada });
      return true;
    },
    // Como el UPDATE condicionado de guardarRechazo: solo desde transcrita.
    async guardarRechazo(idIncapacidad, { causal, fechaRechazo }) {
      const incapacidad = incapacidades.find((i) => i.idIncapacidad === idIncapacidad);
      if (incapacidad?.estado !== 'transcrita') return false;
      Object.assign(incapacidad, { estado: 'rechazada', causalRechazo: causal, fechaRechazo });
      return true;
    },
    // HU-16 (DS-07): como seguimiento.persistence.js.
    async consultarCobradas() {
      return incapacidades
        .filter((i) => i.estado === 'cobrada' && i.decision !== 'dar_de_baja')
        .map((i) => ({
          idIncapacidad: i.idIncapacidad,
          colaborador: colaboradores.find((c) => c.id === i.colaboradorId).nombre,
          entidad: ENTIDADES.find((e) => e.id === i.entidad).nombre,
          tipo: i.tipo,
          fechaInicio: i.fechaInicio,
          diasIncapacidad: i.diasIncapacidad,
          estado: i.estado,
          decision: i.decision ?? null,
          tiempoPago: i.tiempoPago,
          fechaCobrada: i.fechaCobrada,
          ultimoSeguimiento: seguimientos.filter((s) => s.idIncapacidad === i.idIncapacidad).at(-1)?.fecha ?? null,
          requerimientos: requerimientos.filter((r) => r.idIncapacidad === i.idIncapacidad).length,
          ultimoAcuerdo: (({ fecha, valor } = {}) => (fecha ? { fecha, valor } : null))(acuerdos.filter((a) => a.idIncapacidad === i.idIncapacidad).at(-1)),
        }));
    },
    async obtenerDatosSeguimiento(idIncapacidad) {
      const guardada = incapacidades.find((i) => i.idIncapacidad === idIncapacidad);
      if (!guardada) return null;
      return {
        idIncapacidad,
        colaborador: colaboradores.find((c) => c.id === guardada.colaboradorId).nombre,
        entidad: ENTIDADES.find((e) => e.id === guardada.entidad).nombre,
        tipo: guardada.tipo,
        fechaInicio: guardada.fechaInicio,
        diasIncapacidad: guardada.diasIncapacidad,
        estado: guardada.estado,
        decision: guardada.decision ?? null,
        tiempoPago: guardada.tiempoPago ?? null,
        fechaCobrada: guardada.fechaCobrada ?? null,
        requerimientos: requerimientos.filter((r) => r.idIncapacidad === idIncapacidad).length,
        seguimientos: seguimientos
          .filter((x) => x.idIncapacidad === idIncapacidad)
          .map(({ idSeguimiento, fecha }) => ({ idSeguimiento, fecha })),
        acuerdos: acuerdos
          .filter((a) => a.idIncapacidad === idIncapacidad)
          .map(({ idAcuerdo, fecha, valor, registrado }) => ({ idAcuerdo, fecha, valor, registrado })),
      };
    },
    // Como registrar_seguimiento: solo cobrada y sin dar de baja. `fechaSeguimiento` (solo pruebas) fija el momento.
    async guardarSeguimiento(idIncapacidad, { contenido, tipoMime }, creadoPor) {
      const incapacidad = incapacidades.find((i) => i.idIncapacidad === idIncapacidad);
      if (incapacidad?.estado !== 'cobrada' || incapacidad.decision === 'dar_de_baja') return null;
      const idSeguimiento = seguimientos.length + 1;
      seguimientos.push({
        idSeguimiento,
        idIncapacidad,
        evidencia: `incapacidades/${idIncapacidad}/seguimiento-${idSeguimiento}.${EXTENSIONES[tipoMime]}`,
        contenido,
        tipoMime,
        creadoPor,
        fecha: this.fechaSeguimiento ?? '2026-11-21T15:00:00.000Z',
      });
      return idSeguimiento;
    },
    // Como registrar_acuerdo: solo cobrada y sin dar de baja.
    async guardarAcuerdo(idIncapacidad, { fecha, valor }, creadoPor) {
      const incapacidad = incapacidades.find((i) => i.idIncapacidad === idIncapacidad);
      if (incapacidad?.estado !== 'cobrada' || incapacidad.decision === 'dar_de_baja') return null;
      const idAcuerdo = acuerdos.length + 1;
      acuerdos.push({ idAcuerdo, idIncapacidad, fecha, valor, creadoPor, registrado: this.fechaSeguimiento ?? '2026-11-21T16:00:00.000Z' });
      return idAcuerdo;
    },
    // HU-18 (DS-08): como cobro-juridico.persistence.js.
    async obtenerDatosRequerimientos(idIncapacidad) {
      const guardada = incapacidades.find((i) => i.idIncapacidad === idIncapacidad);
      if (!guardada) return null;
      return {
        idIncapacidad,
        colaborador: colaboradores.find((c) => c.id === guardada.colaboradorId).nombre,
        entidad: ENTIDADES.find((e) => e.id === guardada.entidad).nombre,
        tipo: guardada.tipo,
        fechaInicio: guardada.fechaInicio,
        diasIncapacidad: guardada.diasIncapacidad,
        estado: guardada.estado,
        decision: guardada.decision ?? null,
        tiempoPago: guardada.tiempoPago ?? null,
        fechaCobrada: guardada.fechaCobrada ?? null,
        motivoTraslado: guardada.motivoTraslado ?? null,
        fechaTraslado: guardada.fechaTraslado ?? null,
        fechaDecision: guardada.fechaDecision ?? null,
        requerimientos: requerimientos
          .filter((r) => r.idIncapacidad === idIncapacidad)
          .map(({ idRequerimiento, fundamentos, registrado }) => ({ idRequerimiento, fundamentos, registrado })),
      };
    },
    // Como registrar_requerimiento: solo cobrada y sin dar de baja.
    async guardarRequerimiento(idIncapacidad, fundamentos, creadoPor) {
      const incapacidad = incapacidades.find((i) => i.idIncapacidad === idIncapacidad);
      if (incapacidad?.estado !== 'cobrada' || incapacidad.decision === 'dar_de_baja') return null;
      const idRequerimiento = requerimientos.length + 1;
      requerimientos.push({ idRequerimiento, idIncapacidad, fundamentos, creadoPor, registrado: this.fechaSeguimiento ?? '2026-11-21T17:00:00.000Z' });
      return idRequerimiento;
    },
    // Como trasladar_a_cartera: solo cobrada, sin dar de baja y sin trasladar antes.
    async guardarTraslado(idIncapacidad, motivo, fecha) {
      const incapacidad = incapacidades.find((i) => i.idIncapacidad === idIncapacidad);
      if (incapacidad?.estado !== 'cobrada' || incapacidad.decision === 'dar_de_baja' || incapacidad.motivoTraslado != null) return false;
      Object.assign(incapacidad, { motivoTraslado: motivo, fechaTraslado: fecha });
      return true;
    },
    // HU-20 (DS-08): como cobro-juridico.persistence.js.
    async consultarTrasladadas() {
      return incapacidades
        .filter((i) => i.estado === 'cobrada' && i.motivoTraslado != null)
        .map((i) => ({
          idIncapacidad: i.idIncapacidad,
          colaborador: colaboradores.find((c) => c.id === i.colaboradorId).nombre,
          entidad: ENTIDADES.find((e) => e.id === i.entidad).nombre,
          tipo: i.tipo,
          fechaInicio: i.fechaInicio,
          diasIncapacidad: i.diasIncapacidad,
          estado: i.estado,
          decision: i.decision ?? null,
          fechaDecision: i.fechaDecision ?? null,
          tiempoPago: i.tiempoPago,
          fechaCobrada: i.fechaCobrada,
          motivoTraslado: i.motivoTraslado,
          fechaTraslado: i.fechaTraslado,
          requerimientos: requerimientos.filter((r) => r.idIncapacidad === i.idIncapacidad).length,
        }));
    },
    // Como registrar_decision: solo cobrada, trasladada y sin decisión.
    async guardarDecision(idIncapacidad, decision, fecha) {
      const incapacidad = incapacidades.find((i) => i.idIncapacidad === idIncapacidad);
      if (incapacidad?.estado !== 'cobrada' || incapacidad.motivoTraslado == null || incapacidad.decision != null) return false;
      Object.assign(incapacidad, { decision, fechaDecision: fecha });
      return true;
    },
    async deshacerTraslado(idIncapacidad, motivo) {
      const incapacidad = incapacidades.find((i) => i.idIncapacidad === idIncapacidad);
      if (incapacidad?.motivoTraslado === motivo) Object.assign(incapacidad, { motivoTraslado: null, fechaTraslado: null });
    },
    async consultarSeguimiento(idSeguimiento) {
      const s = seguimientos.find((x) => x.idSeguimiento === idSeguimiento);
      return s ? { idSeguimiento, idIncapacidad: s.idIncapacidad, evidencia: s.evidencia } : null;
    },
    async consultarRadicacion(idRadicacion) {
      const r = radicaciones.find((x) => x.idRadicacion === idRadicacion);
      return r ? { idRadicacion, idIncapacidad: r.idIncapacidad, radicado: r.radicado, evidencia: r.evidencia ?? null } : null;
    },
    async descargarEvidencia(evidencia) {
      const r = [...radicaciones, ...seguimientos].find((x) => x.evidencia === evidencia);
      return { contenido: r.contenido, tipoMime: r.tipoMime };
    },
    async consultarDocumento(idDocumento) {
      const documento = documentos.find((d) => d.idDocumento === idDocumento);
      return documento ? { idDocumento, idIncapacidad: documento.idIncapacidad, tipo: documento.tipo, archivo: documento.archivo } : null;
    },
    async descargarDocumento(archivo) {
      const documento = documentos.find((d) => d.archivo === archivo);
      return { contenido: documento.contenido, tipoMime: documento.tipoMime };
    },
    // HU-11 (DS-05): como estados.persistence.js, con los mismos filtros (DA-20).
    async consultarColaboradores() {
      return colaboradores.map(({ id, nombre }) => ({ id, nombre }));
    },
    async consultarIncapacidades(filtros, limite) {
      const filas = incapacidades
        .filter((i) => cumpleFiltros(i, filtros))
        .sort((a, b) => b.fechaInicio.localeCompare(a.fechaInicio) || b.idIncapacidad - a.idIncapacidad)
        .map((i) => ({
          idIncapacidad: i.idIncapacidad,
          colaborador: colaboradores.find((c) => c.id === i.colaboradorId).nombre,
          tipo: i.tipo,
          entidad: ENTIDADES.find((e) => e.id === i.entidad).nombre,
          fechaInicio: i.fechaInicio,
          diasIncapacidad: i.diasIncapacidad,
          estado: i.estado,
          enviadaAGestionDocumental: i.enviadaAGestionDocumental ?? false,
        }));
      return { total: filas.length, filas: filas.slice(0, limite) };
    },
    async contarPorEstado(filtros) {
      return Object.fromEntries(
        ['registrada', 'transcrita', 'cobrada', 'rechazada', 'pagada'].map((estado) => [
          estado,
          incapacidades.filter((i) => cumpleFiltros(i, { ...filtros, estado })).length,
        ]),
      );
    },
    // HU-21 (DS-09): como reconocimiento.persistence.js.
    async consultarParaReconocimiento(limite, filtro = null) {
      const filas = incapacidades
        .filter((i) => !filtro?.id || i.idIncapacidad === filtro.id)
        .filter((i) => !filtro?.colaboradores || filtro.colaboradores.includes(i.colaboradorId))
        .sort((a, b) => b.fechaInicio.localeCompare(a.fechaInicio) || b.idIncapacidad - a.idIncapacidad);
      return { total: filas.length, filas: await Promise.all(filas.slice(0, limite).map((i) => this.obtenerDatosReconocimiento(i.idIncapacidad))) };
    },
    async obtenerDatosReconocimiento(idIncapacidad) {
      const i = incapacidades.find((x) => x.idIncapacidad === idIncapacidad);
      if (!i) return null;
      return {
        idIncapacidad,
        colaborador: colaboradores.find((c) => c.id === i.colaboradorId).nombre,
        entidad: ENTIDADES.find((e) => e.id === i.entidad).nombre,
        entidadTipo: ENTIDADES.find((e) => e.id === i.entidad).tipo,
        tipo: i.tipo,
        fechaInicio: i.fechaInicio,
        diasIncapacidad: i.diasIncapacidad,
        estado: i.estado,
        ibc: i.ibc ?? null,
        valorEmpresa: i.valorEmpresa ?? null,
        valorEPS: i.valorEPS ?? null,
        tramitePension: i.tramitePension ?? false,
        fechaCalculo: i.fechaCalculo ?? null,
        ...datosDelCaso(i),
      };
    },
    async guardarCalculo(idIncapacidad, calculo, por) {
      const i = incapacidades.find((x) => x.idIncapacidad === idIncapacidad);
      if (!i || i.estado === 'pagada') return false; // DA-53
      Object.assign(i, calculo, { fechaCalculo: new Date().toISOString(), calculoPor: por });
      return true;
    },
    // HU-22 y HU-23 (DS-10): como monitoreo.persistence.js (escrituras condicionadas).
    async obtenerDatosProlongada(idIncapacidad) {
      const i = incapacidades.find((x) => x.idIncapacidad === idIncapacidad);
      if (!i) return null;
      const c = colaboradores.find((x) => x.id === i.colaboradorId);
      return {
        idIncapacidad,
        colaborador: c.nombre,
        correoColaborador: c.correo,
        entidad: ENTIDADES.find((e) => e.id === i.entidad).nombre,
        tipo: i.tipo,
        fechaInicio: i.fechaInicio,
        diasIncapacidad: i.diasIncapacidad,
        estado: i.estado,
        concepto: i.concepto ?? null,
        faltaConcepto: i.faltaConcepto ?? false,
        pagoSuspendido: i.pagoSuspendido ?? false,
        fechaConcepto: i.fechaConcepto ?? null,
        fechaFaltaConcepto: i.fechaFaltaConcepto ?? null,
        fechaSuspension: i.fechaSuspension ?? null,
        ...datosDelCaso(i),
        ...(i.tieneProrroga ? { prorroga: incapacidades.find((x) => x.prorrogaDe === i.idIncapacidad)?.idIncapacidad ?? null } : {}),
      };
    },
    async consultarProlongadas(dias) {
      const ids = incapacidades
        .filter((i) => diasDelCaso(datosDelCaso(i)) > dias && !i.tieneProrroga)
        .sort((a, b) => diasDelCaso(datosDelCaso(b)) - diasDelCaso(datosDelCaso(a)) || a.idIncapacidad - b.idIncapacidad);
      return Promise.all(ids.map((i) => this.obtenerDatosProlongada(i.idIncapacidad)));
    },
    async guardarConcepto(idIncapacidad, concepto, dia, por) {
      const i = incapacidades.find((x) => x.idIncapacidad === idIncapacidad);
      if (!i || !cumpleDia(i, dia) || i.concepto != null) return false;
      Object.assign(i, { concepto, faltaConcepto: false, fechaConcepto: new Date().toISOString(), conceptoPor: por });
      return true;
    },
    // DA-50: los «deshacer» también revierten la prórroga que copió el estado (como monitoreo.persistence.js).
    async deshacerConcepto(idIncapacidad, concepto, faltaConcepto) {
      for (const i of incapacidades.filter((x) => x.idIncapacidad === idIncapacidad || x.prorrogaDe === idIncapacidad)) {
        if (i.concepto === concepto) Object.assign(i, { concepto: null, faltaConcepto, fechaConcepto: null, conceptoPor: null });
      }
    },
    async guardarFaltaConcepto(idIncapacidad, dia, por) {
      const i = incapacidades.find((x) => x.idIncapacidad === idIncapacidad);
      if (!i || !cumpleDia(i, dia) || i.concepto != null || i.faltaConcepto) return false;
      Object.assign(i, { faltaConcepto: true, fechaFaltaConcepto: new Date().toISOString(), faltaConceptoPor: por });
      return true;
    },
    async deshacerFaltaConcepto(idIncapacidad) {
      for (const i of incapacidades.filter((x) => x.idIncapacidad === idIncapacidad || x.prorrogaDe === idIncapacidad)) {
        if (i.concepto == null) Object.assign(i, { faltaConcepto: false, fechaFaltaConcepto: null, faltaConceptoPor: null });
      }
    },
    async guardarSuspensionPago(idIncapacidad, dia, por) {
      const i = incapacidades.find((x) => x.idIncapacidad === idIncapacidad);
      if (!i || !cumpleDia(i, dia) || i.pagoSuspendido) return false;
      Object.assign(i, { pagoSuspendido: true, fechaSuspension: new Date().toISOString(), suspensionPor: por });
      return true;
    },
    async deshacerSuspensionPago(idIncapacidad) {
      for (const i of incapacidades.filter((x) => x.idIncapacidad === idIncapacidad || x.prorrogaDe === idIncapacidad)) {
        if (i.pagoSuspendido) Object.assign(i, { pagoSuspendido: false, fechaSuspension: null, suspensionPor: null });
      }
    },
    // HU-12 (DS-14): como alertas.persistence.js (sin radicar, aviso pendiente o 90 días o más).
    async consultarPlazos() {
      return incapacidades
        .filter((i) => i.estado == null || i.estado === 'rechazada' || i.documentacionCompleta === false || diasDelCaso(datosDelCaso(i)) >= 90)
        .map((i) => {
          const { id, nombre } = ENTIDADES.find((e) => e.id === i.entidad);
          const { plazoTranscripcion, plazoTranscripcionTransito } = PLAZOS[id];
          return {
            idIncapacidad: i.idIncapacidad,
            colaborador: colaboradores.find((c) => c.id === i.colaboradorId).nombre,
            tipo: i.tipo,
            fechaInicio: i.fechaInicio,
            diasIncapacidad: i.diasIncapacidad,
            fechaRecepcion: i.fechaRecepcion,
            fechaNacimiento: i.fechaNacimiento ?? null,
            estado: i.estado,
            documentacionCompleta: i.documentacionCompleta ?? null,
            fechaAvisoFaltantes: i.fechaAvisoFaltantes ?? null,
            segundoLlamado: i.segundoLlamado ?? false,
            ...datosDelCaso(i),
            entidad: { nombre, plazoTranscripcion, plazoTranscripcionTransito },
          };
        });
    },
    // HU-25 (DS-11): como conciliacion.persistence.js.
    async guardarPagosConsignados(entidadId, pagos, por) {
      const creadoEn = new Date().toISOString();
      return pagos.map((p) => {
        const id = pagosConsignados.length + 1;
        pagosConsignados.push({ id, entidadId, ...p, creadoPor: por, creadoEn });
        return id;
      });
    },
    async eliminarPagosConsignados(ids) {
      for (const id of ids) {
        const i = pagosConsignados.findIndex((p) => p.id === id);
        if (i >= 0) pagosConsignados.splice(i, 1);
      }
    },
    async consultarPagosConsignados(limite) {
      return [...pagosConsignados]
        .sort((a, b) => b.creadoEn.localeCompare(a.creadoEn) || b.id - a.id)
        .slice(0, limite)
        .map((p) => ({ ...p, entidad: ENTIDADES.find((e) => e.id === p.entidadId).nombre }));
    },
    // HU-26 (DS-11): como conciliacion.persistence.js.
    async obtenerPagosConsignados(entidadId) {
      return pagosConsignados
        .filter((p) => p.entidadId === entidadId && p.conciliacionId == null)
        .sort((a, b) => a.id - b.id)
        .map((p) => ({ ...p, entidad: nombreEntidad(p.entidadId) }));
    },
    async consultarPagosPorConciliar(entidadId) {
      return pagos
        .filter((p) => !p.conciliado && incapacidades.find((i) => i.idIncapacidad === p.idIncapacidad)?.entidad === entidadId)
        .sort((a, b) => a.fechaPago.localeCompare(b.fechaPago) || a.idPago - b.idPago)
        .map((p) => {
          const i = incapacidades.find((x) => x.idIncapacidad === p.idIncapacidad);
          return {
            idPago: p.idPago,
            idIncapacidad: p.idIncapacidad,
            colaborador: colaboradores.find((c) => c.id === i.colaboradorId).nombre,
            valor: p.valor,
            fechaPago: p.fechaPago,
          };
        });
    },
    async contarPorIdentificar() {
      return pagosConsignados
        .filter((p) => p.conciliacionId == null)
        .reduce((cuenta, p) => ({ ...cuenta, [p.entidadId]: (cuenta[p.entidadId] ?? 0) + 1 }), {});
    },
    async guardarConciliacion(entidadId, datos, por) {
      return registrarConciliacion(entidadId, datos, por);
    },
    async guardarSaldosPendientes(entidadId, datos, por) {
      return registrarConciliacion(entidadId, datos, por);
    },
    async deshacerConciliacion(id) {
      // Como deshacer_conciliacion (DA-59): con una incapacidad ya enviada falla sin cambiar nada; si no, quita la marca
      // de archivo preparado de las incapacidades cuyos pagos libera.
      const afectadas = pagos
        .filter((p) => p.conciliacionId === id)
        .map((p) => incapacidades.find((x) => x.idIncapacidad === p.idIncapacidad))
        .filter(Boolean);
      if (afectadas.some((i) => i.enviadaAGestionDocumental)) {
        throw Object.assign(new Error(`La conciliación ${id} incluye una incapacidad ya enviada a Gestión Documental: no se deshace`), { code: 'SG001' });
      }
      for (const i of afectadas) Object.assign(i, { fechaArchivoPreparado: null, archivoPreparadoPor: null });
      for (const p of pagos) if (p.conciliacionId === id) Object.assign(p, { conciliado: false, conciliacionId: null });
      for (const p of pagosConsignados) if (p.conciliacionId === id) p.conciliacionId = null;
      const i = conciliaciones.findIndex((c) => c.id === id);
      if (i >= 0) conciliaciones.splice(i, 1);
    },
    async consultarConciliaciones(limite) {
      return [...conciliaciones]
        .sort((a, b) => b.creadoEn.localeCompare(a.creadoEn) || b.id - a.id)
        .slice(0, limite)
        .map((c) => ({ ...c, entidad: nombreEntidad(c.entidadId) }));
    },
    async consultarConciliacion(id) {
      const c = conciliaciones.find((x) => x.id === id);
      return c ? { ...c, entidad: nombreEntidad(c.entidadId) } : null;
    },
    // HU-27 (DS-12): como reportes.persistence.js.
    async consultarDatosReporte(desde, hasta) {
      return incapacidades
        .filter((i) => i.fechaInicio <= hasta)
        .sort((a, b) => a.idIncapacidad - b.idIncapacidad)
        .map((i) => ({
          idIncapacidad: i.idIncapacidad,
          idColaborador: i.colaboradorId,
          colaborador: colaboradores.find((c) => c.id === i.colaboradorId).nombre,
          tipo: i.tipo,
          entidad: nombreEntidad(i.entidad),
          fechaInicio: i.fechaInicio,
          diasIncapacidad: i.diasIncapacidad,
          estado: i.estado,
        }));
    },
    // HU-28 (DS-12): como reportes.persistence.js.
    async consultarDatosProlongadas(dias, desde, hasta) {
      return incapacidades
        .filter((i) => diasDelCaso(datosDelCaso(i)) > dias && i.fechaInicio <= hasta)
        .sort((a, b) => a.idIncapacidad - b.idIncapacidad)
        .map((i) => ({
          idIncapacidad: i.idIncapacidad,
          idColaborador: i.colaboradorId,
          colaborador: colaboradores.find((c) => c.id === i.colaboradorId).nombre,
          tipo: i.tipo,
          entidad: nombreEntidad(i.entidad),
          fechaInicio: i.fechaInicio,
          diasIncapacidad: i.diasIncapacidad,
          estado: i.estado,
          concepto: i.concepto == null ? null : true,
          faltaConcepto: i.faltaConcepto ?? false,
          pagoSuspendido: i.pagoSuspendido ?? false,
          ...datosDelCaso(i),
        }));
    },
    async guardarReporte(tipo, periodo, contenido, por) {
      const id = (reportes.at(-1)?.id ?? 0) + 1;
      reportes.push({ id, tipo, periodo, contenido: structuredClone(contenido), creadoPor: por, creadoEn: new Date().toISOString() });
      return id;
    },
    async eliminarReporte(id) {
      const i = reportes.findIndex((r) => r.id === id);
      if (i >= 0) reportes.splice(i, 1);
    },
    async consultarReportes(tipo, limite) {
      return reportes
        .filter((r) => r.tipo === tipo)
        .sort((a, b) => b.creadoEn.localeCompare(a.creadoEn) || b.id - a.id)
        .slice(0, limite)
        .map(({ creadoPor, ...r }) => r);
    },
    async consultarUltimoReporte(tipo, periodo) {
      const [ultimo] = await this.consultarReportes(tipo, Infinity).then((l) => l.filter((r) => r.periodo === periodo));
      return ultimo ?? null;
    },
    async consultarReporte(id) {
      const r = reportes.find((x) => x.id === id);
      if (!r) return null;
      const { creadoPor, ...datos } = r;
      return datos;
    },
    // HU-29 / HU-30 (DS-13): como archivo.persistence.js, preparar_archivo y registrar_envio_archivo (DA-59, DA-60).
    async obtenerPagadas() {
      return incapacidades
        .filter((i) => i.estado === 'pagada' && !i.enviadaAGestionDocumental)
        .sort((a, b) => b.fechaInicio.localeCompare(a.fechaInicio) || b.idIncapacidad - a.idIncapacidad)
        .map((i) => datosArchivo(i));
    },
    async obtenerDatosArchivo(idIncapacidad) {
      const i = incapacidades.find((x) => x.idIncapacidad === idIncapacidad);
      return i ? datosArchivo(i) : null;
    },
    async guardarArchivoPreparado(idIncapacidad, por) {
      const i = incapacidades.find((x) => x.idIncapacidad === idIncapacidad);
      if (!i || i.estado !== 'pagada' || i.fechaArchivoPreparado != null || i.enviadaAGestionDocumental) return false;
      const suyos = pagos.filter((p) => p.idIncapacidad === idIncapacidad);
      if (suyos.length === 0 || suyos.some((p) => !p.conciliado)) return false;
      Object.assign(i, { fechaArchivoPreparado: new Date().toISOString(), archivoPreparadoPor: por });
      return true;
    },
    async deshacerArchivoPreparado(idIncapacidad) {
      const i = incapacidades.find((x) => x.idIncapacidad === idIncapacidad);
      if (i && !i.enviadaAGestionDocumental) Object.assign(i, { fechaArchivoPreparado: null, archivoPreparadoPor: null });
    },
    async contarEnviadas() {
      return incapacidades.filter((i) => i.enviadaAGestionDocumental).length;
    },
    async obtenerEnviadas(limite) {
      return incapacidades
        .filter((i) => i.enviadaAGestionDocumental)
        .sort((a, b) => (b.fechaEnvioArchivo ?? '').localeCompare(a.fechaEnvioArchivo ?? '') || b.idIncapacidad - a.idIncapacidad)
        .slice(0, limite)
        .map((i) => datosArchivo(i));
    },
    async guardarEnvio(idIncapacidad, por) {
      const i = incapacidades.find((x) => x.idIncapacidad === idIncapacidad);
      if (!i || i.estado !== 'pagada' || i.fechaArchivoPreparado == null || i.enviadaAGestionDocumental) return false;
      Object.assign(i, { enviadaAGestionDocumental: true, fechaEnvioArchivo: new Date().toISOString(), envioArchivoPor: por });
      return true;
    },
    async eliminarEpicrisis(idIncapacidad) {
      let eliminadas = 0;
      for (let k = documentos.length - 1; k >= 0; k--) {
        if (documentos[k].idIncapacidad === idIncapacidad && documentos[k].tipo === 'epicrisis') {
          documentos.splice(k, 1);
          eliminadas++;
        }
      }
      return eliminadas;
    },
    async consultarReemplazo(idIncapacidad) {
      return reemplazos.find((r) => r.idIncapacidad === idIncapacidad)?.reemplazo ?? null;
    },
    async guardarReemplazo(idIncapacidad, reemplazo, creadoPor) {
      const anterior = reemplazos.findIndex((r) => r.idIncapacidad === idIncapacidad);
      if (anterior >= 0) reemplazos.splice(anterior, 1);
      reemplazos.push({ idIncapacidad, reemplazo, creadoPor });
    },
  };
}
