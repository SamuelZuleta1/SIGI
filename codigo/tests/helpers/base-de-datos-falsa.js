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

export function crearBaseDeDatosFalsa() {
  const colaboradores = [];
  const incapacidades = [];
  const documentos = [];
  const reemplazos = []; // máximo uno por incapacidad, como el índice único de la tabla
  return {
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
        fechaNacimiento: guardada.fechaNacimiento ?? null,
        estado: guardada.estado,
        documentacionCompleta: guardada.documentacionCompleta ?? null,
        archivadoDigital: guardada.archivadoDigital ?? false,
        entidad: { ...entidad, ...PLAZOS[id] },
      };
    },
    async consultarDocumento(idDocumento) {
      const documento = documentos.find((d) => d.idDocumento === idDocumento);
      return documento ? { idDocumento, idIncapacidad: documento.idIncapacidad, tipo: documento.tipo, archivo: documento.archivo } : null;
    },
    async descargarDocumento(archivo) {
      const documento = documentos.find((d) => d.archivo === archivo);
      return { contenido: documento.contenido, tipoMime: documento.tipoMime };
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
