// Grupo `registro` de la Base de datos — DS-01 (CU-01, CU-02).
// Operaciones: guardarIncapacidad, guardarDocumentos (incluye marcarOriginalPendiente).
// Las escrituras de cada operación van en una sola transacción, con las funciones
// registrar_incapacidad y registrar_documentos (migración registro_atomico).
// Apoyo: consultarEntidades, para el formulario de registro (DA-03), y consultarIncapacidad,
// para mostrar a qué incapacidad se le registran los documentos y armar el aviso al auxiliar.
import { randomUUID } from 'node:crypto';
import { crearAlmacenDocumentos } from './almacen-documentos.js';

const EXTENSIONES = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

const comprobar = ({ data, error }) => {
  if (error) throw error;
  return data;
};

export function crearPersistenciaRegistro(cliente, almacen = crearAlmacenDocumentos(cliente)) {
  return {
    /** Entidades ante las que se tramita una incapacidad: EPS y ARL (HU-03). */
    async consultarEntidades() {
      return comprobar(
        await cliente.from('entidad').select('id, nombre, tipo').in('tipo', ['EPS', 'ARL']).order('nombre'),
      );
    },

    /**
     * DS-01: guardarIncapacidad(colaborador, tipo, entidad, fechaInicio, dias, fechaRecepcion) → idIncapacidad.
     * `colaborador` es { nombre, correo }: si no existe uno con ese correo, se crea (DA-03, DA-04);
     * si ya existe, se usa el que está guardado. `creadoPor` es el usuario que registra (DA-23).
     * Todo en una transacción: si la incapacidad no se puede guardar, tampoco queda el colaborador.
     */
    async guardarIncapacidad({ colaborador, tipo, entidad, fechaInicio, diasIncapacidad, fechaRecepcion }, creadoPor) {
      const id = comprobar(
        await cliente.rpc('registrar_incapacidad', {
          p_nombre: colaborador.nombre,
          p_correo: colaborador.correo,
          p_entidad_id: entidad,
          p_tipo: tipo,
          p_fecha_inicio: fechaInicio,
          p_dias: diasIncapacidad,
          p_fecha_recepcion: fechaRecepcion,
          p_creado_por: creadoPor,
        }),
      );
      return Number(id);
    },

    /**
     * Datos que identifican una incapacidad (los del correo `notificarRecepcion`), o null si no existe.
     * No trae información clínica.
     */
    async consultarIncapacidad(idIncapacidad) {
      const fila = comprobar(
        await cliente
          .from('incapacidad')
          .select('id, tipo, fecha_inicio, dias_incapacidad, original_pendiente, fecha_archivo_preparado, colaborador(nombre, correo), entidad(nombre)')
          .eq('id', idIncapacidad)
          .maybeSingle(),
      );
      if (!fila) return null;
      return {
        idIncapacidad: fila.id,
        colaborador: fila.colaborador.nombre,
        correoColaborador: fila.colaborador.correo,
        tipo: fila.tipo,
        entidad: fila.entidad.nombre,
        fechaInicio: fila.fecha_inicio,
        diasIncapacidad: fila.dias_incapacidad,
        originalPendiente: fila.original_pendiente,
        // Con el archivo preparado (HU-29, DA-59) ya no se recibe epicrisis: se eliminó al archivar.
        archivoPreparado: fila.fecha_archivo_preparado != null,
      };
    },

    /**
     * DS-01: guardarDocumentos(documentos). Cada documento es { tipo, contenido, tipoMime }:
     * el archivo se sube al bucket privado y en la tabla queda su tipo y su ruta (CL-01).
     * Ruta: incapacidades/{idIncapacidad}/{tipo}-{uuid}.{ext}. El nombre original no se usa:
     * puede traer datos personales o caracteres que Storage no acepta.
     * Con `originalPendiente`, en la misma transacción marca el original en físico como pendiente
     * (DS-01 alt. correo, HU-04.CA2): o quedan los documentos y la marca, o no queda ninguno.
     * Si algo falla, se borran los archivos que ya se habían subido.
     * @returns {Promise<Array<{ tipo: string, archivo: string }>>}
     */
    async guardarDocumentos(idIncapacidad, documentos, creadoPor, { originalPendiente = false } = {}) {
      const guardados = [];
      try {
        for (const { tipo, contenido, tipoMime } of documentos) {
          const archivo = `incapacidades/${idIncapacidad}/${tipo}-${randomUUID()}.${EXTENSIONES[tipoMime]}`;
          await almacen.guardar(archivo, contenido, tipoMime);
          guardados.push({ tipo, archivo });
        }
        comprobar(
          await cliente.rpc('registrar_documentos', {
            p_incapacidad_id: idIncapacidad,
            p_documentos: guardados,
            p_original_pendiente: originalPendiente,
            p_creado_por: creadoPor,
          }),
        );
        return guardados;
      } catch (error) {
        await almacen.eliminar(guardados.map((documento) => documento.archivo)).catch(() => {});
        throw error;
      }
    },
  };
}
