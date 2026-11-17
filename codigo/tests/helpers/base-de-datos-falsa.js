// Persistencia falsa en memoria para las pruebas unitarias y HTTP: no usa Supabase.
export const ENTIDADES = Object.freeze([
  { id: 1, nombre: 'ARL SURA', tipo: 'ARL' },
  { id: 2, nombre: 'Nueva EPS', tipo: 'EPS' },
  { id: 3, nombre: 'Sanitas', tipo: 'EPS' },
]);

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
        idIncapacidad,
        tipo,
        archivo: `incapacidades/${idIncapacidad}/${tipo}-${documentos.length + i + 1}`,
        tipoMime,
        tamano: contenido.length,
        creadoPor,
      }));
      documentos.push(...guardados);
      if (originalPendiente) incapacidades.find((i) => i.idIncapacidad === idIncapacidad).originalPendiente = true;
      return guardados.map(({ tipo, archivo }) => ({ tipo, archivo }));
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
