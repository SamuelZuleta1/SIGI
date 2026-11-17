// Persistencia falsa en memoria para las pruebas unitarias y HTTP: no usa Supabase.
export const ENTIDADES = Object.freeze([
  { id: 1, nombre: 'ARL SURA', tipo: 'ARL' },
  { id: 2, nombre: 'Nueva EPS', tipo: 'EPS' },
  { id: 3, nombre: 'Sanitas', tipo: 'EPS' },
]);

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
      if (originalPendiente) incapacidades.find((i) => i.idIncapacidad === idIncapacidad).originalPendiente = true;
      return guardados.map(({ tipo, archivo }) => ({ tipo, archivo }));
    },
    async obtenerExpediente(idIncapacidad) {
      const datos = await this.consultarIncapacidad(idIncapacidad);
      if (!datos) return null;
      const guardada = incapacidades.find((i) => i.idIncapacidad === idIncapacidad);
      const { correoColaborador, ...expediente } = datos;
      return {
        ...expediente,
        documentacionCompleta: guardada.documentacionCompleta ?? null,
        archivadoDigital: guardada.archivadoDigital ?? false,
        documentos: documentos.filter((d) => d.idIncapacidad === idIncapacidad).map(({ idDocumento, tipo }) => ({ idDocumento, tipo })),
      };
    },
    async archivarDigital(idIncapacidad) {
      Object.assign(incapacidades.find((i) => i.idIncapacidad === idIncapacidad), { documentacionCompleta: true, archivadoDigital: true });
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
