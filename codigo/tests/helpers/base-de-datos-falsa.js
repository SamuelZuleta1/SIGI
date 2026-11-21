// Persistencia falsa en memoria para las pruebas unitarias y HTTP: no usa Supabase.
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

export function crearBaseDeDatosFalsa() {
  const colaboradores = [];
  const incapacidades = [];
  const documentos = [];
  const reemplazos = []; // máximo uno por incapacidad, como el índice único de la tabla
  const radicaciones = [];
  return {
    radicaciones,
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
        tiempoPago: guardada.tiempoPago ?? null,
        fechaCobrada: guardada.fechaCobrada ?? null,
        radicaciones: radicaciones
          .filter((r) => r.idIncapacidad === idIncapacidad)
          .map(({ idRadicacion, radicado, evidencia, fecha }) => ({ idRadicacion, radicado, conEvidencia: Boolean(evidencia), fecha })),
      };
    },
    // Como el UPDATE condicionado de guardarCobrada: solo desde transcrita.
    async guardarCobrada(idIncapacidad, { tiempoPago, fechaCobrada }) {
      const incapacidad = incapacidades.find((i) => i.idIncapacidad === idIncapacidad);
      if (incapacidad?.estado !== 'transcrita') return false;
      Object.assign(incapacidad, { estado: 'cobrada', tiempoPago, fechaCobrada });
      return true;
    },
    async consultarRadicacion(idRadicacion) {
      const r = radicaciones.find((x) => x.idRadicacion === idRadicacion);
      return r ? { idRadicacion, idIncapacidad: r.idIncapacidad, radicado: r.radicado, evidencia: r.evidencia ?? null } : null;
    },
    async descargarEvidencia(evidencia) {
      const r = radicaciones.find((x) => x.evidencia === evidencia);
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
    // HU-12 (DS-14): como alertas.persistence.js (sin radicar, aviso pendiente o 90 días o más).
    async consultarPlazos() {
      return incapacidades
        .filter((i) => i.estado == null || i.estado === 'rechazada' || i.documentacionCompleta === false || i.diasIncapacidad >= 90)
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
            entidad: { nombre, plazoTranscripcion, plazoTranscripcionTransito },
          };
        });
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
