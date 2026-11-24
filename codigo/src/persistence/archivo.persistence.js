// Grupo `archivo` de la Base de datos — DS-13 (CU-17).
// Operaciones: obtenerPagadas (HU-29.CA1), obtenerDatosArchivo y obtenerEstadoPago (apoyo de la Vista y del Control),
// guardarArchivoPreparado con su «deshacer» (si el correo a Gestión Documental falla), eliminarEpicrisis (DA-12) y
// guardarEnvio, contarEnviadas y obtenerEnviadas (HU-30, DA-60).
import { BLOQUE } from './alertas.persistence.js';
import { crearAlmacenDocumentos } from './almacen-documentos.js';

const comprobar = ({ data, error }) => {
  if (error) throw error;
  return data;
};

const COLUMNAS =
  'id, tipo, fecha_inicio, dias_incapacidad, estado, enviada_a_gestion_documental, fecha_archivo_preparado, ' +
  'fecha_envio_archivo, envio:usuario!incapacidad_envio_archivo_por_fkey(correo), ' +
  'colaborador(nombre), entidad(nombre), pago(id, valor, fecha_pago, conciliado), documento(id, tipo)';

const aDatos = (f) => ({
  idIncapacidad: f.id,
  colaborador: f.colaborador.nombre,
  entidad: f.entidad.nombre,
  tipo: f.tipo,
  fechaInicio: f.fecha_inicio,
  diasIncapacidad: f.dias_incapacidad,
  estado: f.estado,
  enviadaAGestionDocumental: f.enviada_a_gestion_documental,
  fechaArchivoPreparado: f.fecha_archivo_preparado,
  fechaEnvioArchivo: f.fecha_envio_archivo,
  envioArchivoPor: f.envio?.correo ?? null,
  pagos: [...f.pago]
    .sort((a, b) => a.fecha_pago.localeCompare(b.fecha_pago) || a.id - b.id)
    .map((p) => ({ idPago: p.id, valor: p.valor, fechaPago: p.fecha_pago, conciliado: p.conciliado })),
  documentos: [...f.documento].sort((a, b) => a.id - b.id).map((d) => ({ idDocumento: d.id, tipo: d.tipo })),
});

export function crearPersistenciaArchivo(cliente, almacen = crearAlmacenDocumentos(cliente)) {
  return {
    /**
     * DS-13: obtenerPagadas() — HU-29.CA1. Las pagadas que aún no se enviaron a Gestión Documental, con sus pagos y
     * documentos, de la más reciente a la más antigua. Se leen en bloques (máximo de la API). Las enviadas van aparte
     * (contarEnviadas, obtenerEnviadas): son un historial que solo crece (DA-60).
     */
    async obtenerPagadas() {
      const filas = [];
      for (;;) {
        const desde = filas.length;
        const bloque = comprobar(
          await cliente
            .from('incapacidad')
            .select(COLUMNAS)
            .eq('estado', 'pagada')
            .eq('enviada_a_gestion_documental', false)
            .order('fecha_inicio', { ascending: false })
            .order('id', { ascending: false })
            .range(desde, desde + BLOQUE - 1),
        );
        if (bloque.length === 0) break;
        filas.push(...bloque);
      }
      return filas.map(aDatos);
    },

    /** La incapacidad con lo que necesita el archivo (y el correo a Gestión Documental). null si no existe. */
    async obtenerDatosArchivo(idIncapacidad) {
      const fila = comprobar(await cliente.from('incapacidad').select(COLUMNAS).eq('id', idIncapacidad).maybeSingle());
      return fila ? aDatos(fila) : null;
    },

    /**
     * DS-13: guardarArchivoPreparado — en una transacción (`preparar_archivo`) comprueba que está pagada, sin preparar y
     * con todos sus pagos conciliados (DA-11), y guarda quién y cuándo (DA-23).
     * @returns {Promise<boolean>} false si el estado ya no lo permitía.
     */
    async guardarArchivoPreparado(idIncapacidad, por) {
      return comprobar(await cliente.rpc('preparar_archivo', { p_incapacidad_id: idIncapacidad, p_por: por })) === true;
    },

    /** Quita la marca de archivo preparado (si el correo a Gestión Documental falló). */
    async deshacerArchivoPreparado(idIncapacidad) {
      comprobar(await cliente.rpc('deshacer_archivo_preparado', { p_incapacidad_id: idIncapacidad }));
    },

    /**
     * DS-13: eliminarEpicrisis(idIncapacidad) — DA-12: solo la epicrisis; la historia clínica y los demás documentos se
     * conservan. Primero borra los archivos del bucket y después las filas: si algo falla a mitad, repetirlo termina el
     * trabajo (borrar un archivo que ya no está no es un error en Storage).
     * @returns {Promise<number>} cuántas epicrisis eliminó.
     */
    async eliminarEpicrisis(idIncapacidad) {
      const epicrisis = comprobar(
        await cliente.from('documento').select('id, archivo').eq('incapacidad_id', idIncapacidad).eq('tipo', 'epicrisis'),
      );
      if (epicrisis.length === 0) return 0;
      // B4 (DA-59): la marca va antes de borrar y no la quita ningún deshacer. Si el borrado falla, la epicrisis sigue
      // ahí y se muestra recibida (la marca solo cuenta cuando ya no queda ninguna).
      comprobar(
        await cliente
          .from('incapacidad')
          .update({ epicrisis_eliminada_en: new Date().toISOString() })
          .eq('id', idIncapacidad)
          .is('epicrisis_eliminada_en', null),
      );
      await almacen.eliminar(epicrisis.map((d) => d.archivo));
      comprobar(
        await cliente
          .from('documento')
          .delete()
          .in('id', epicrisis.map((d) => d.id)),
      );
      return epicrisis.length;
    },

    /**
     * DS-13: guardarEnvio(idIncapacidad) — HU-30. En un solo UPDATE (`registrar_envio_archivo`) comprueba que está
     * pagada, con el archivo preparado y sin enviar, y guarda el envío con quién y cuándo (DA-23, DA-60).
     * @returns {Promise<boolean>} false si el estado ya no lo permitía.
     */
    async guardarEnvio(idIncapacidad, por) {
      return comprobar(await cliente.rpc('registrar_envio_archivo', { p_incapacidad_id: idIncapacidad, p_por: por })) === true;
    },

    /** HU-30 (DA-60): cuántas incapacidades ya se enviaron a Gestión Documental (pestaña «Enviadas»). */
    async contarEnviadas() {
      const { count, error } = await cliente
        .from('incapacidad')
        .select('id', { count: 'exact', head: true })
        .eq('enviada_a_gestion_documental', true);
      if (error) throw error;
      return count ?? 0;
    },

    /** HU-30 (DA-60): las `limite` enviadas más recientes, por fecha de envío. */
    async obtenerEnviadas(limite) {
      const filas = comprobar(
        await cliente
          .from('incapacidad')
          .select(COLUMNAS)
          .eq('enviada_a_gestion_documental', true)
          .order('fecha_envio_archivo', { ascending: false })
          .order('id', { ascending: false })
          .limit(limite),
      );
      return filas.map(aDatos);
    },
  };
}
