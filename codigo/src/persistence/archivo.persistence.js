// Grupo `archivo` de la Base de datos — DS-13 (CU-17).
// Operaciones: obtenerPagadas (HU-29.CA1), obtenerDatosArchivo y obtenerEstadoPago (apoyo de la Vista y del Control),
// guardarArchivoPreparado con su «deshacer» (si el correo a Gestión Documental falla) y eliminarEpicrisis (DA-12).
import { BLOQUE } from './alertas.persistence.js';
import { crearAlmacenDocumentos } from './almacen-documentos.js';

const comprobar = ({ data, error }) => {
  if (error) throw error;
  return data;
};

const COLUMNAS =
  'id, tipo, fecha_inicio, dias_incapacidad, estado, enviada_a_gestion_documental, fecha_archivo_preparado, ' +
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
  pagos: [...f.pago]
    .sort((a, b) => a.fecha_pago.localeCompare(b.fecha_pago) || a.id - b.id)
    .map((p) => ({ idPago: p.id, valor: p.valor, fechaPago: p.fecha_pago, conciliado: p.conciliado })),
  documentos: [...f.documento].sort((a, b) => a.id - b.id).map((d) => ({ idDocumento: d.id, tipo: d.tipo })),
});

export function crearPersistenciaArchivo(cliente, almacen = crearAlmacenDocumentos(cliente)) {
  return {
    /**
     * DS-13: obtenerPagadas() — HU-29.CA1. Las pagadas que aún no se enviaron a Gestión Documental, con sus pagos y
     * documentos, de la más reciente a la más antigua. Se leen en bloques (máximo de la API).
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
      await almacen.eliminar(epicrisis.map((d) => d.archivo));
      comprobar(
        await cliente
          .from('documento')
          .delete()
          .in('id', epicrisis.map((d) => d.id)),
      );
      return epicrisis.length;
    },
  };
}
