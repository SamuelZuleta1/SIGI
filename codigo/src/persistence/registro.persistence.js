// Grupo `registro` de la Base de datos — DS-01 (CU-01, CU-02).
// Operaciones: guardarIncapacidad, guardarDocumentos, marcarOriginalPendiente.
// Apoyo: consultarEntidades, para el formulario de registro (DA-03), y consultarIncapacidad,
// para mostrar a qué incapacidad se le registran los documentos y armar el aviso al auxiliar.
import { randomUUID } from 'node:crypto';
import { crearAlmacenDocumentos } from './almacen-documentos.js';
import { aFila } from './conversion.js';

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
     */
    async guardarIncapacidad({ colaborador, tipo, entidad, fechaInicio, diasIncapacidad, fechaRecepcion }, creadoPor) {
      // «Insertar si no existe» en una sola sentencia: dos registros simultáneos no chocan.
      comprobar(
        await cliente
          .from('colaborador')
          .upsert({ ...colaborador, creado_por: creadoPor }, { onConflict: 'correo', ignoreDuplicates: true }),
      );
      const { id: colaboradorId } = comprobar(
        await cliente.from('colaborador').select('id').eq('correo', colaborador.correo).single(),
      );
      const { id } = comprobar(
        await cliente
          .from('incapacidad')
          .insert(aFila({ colaboradorId, entidadId: entidad, tipo, fechaInicio, diasIncapacidad, fechaRecepcion, creadoPor }))
          .select('id')
          .single(),
      );
      return id;
    },

    /**
     * Datos que identifican una incapacidad (los del correo `notificarRecepcion`), o null si no existe.
     * No trae información clínica.
     */
    async consultarIncapacidad(idIncapacidad) {
      const fila = comprobar(
        await cliente
          .from('incapacidad')
          .select('id, tipo, fecha_inicio, dias_incapacidad, original_pendiente, colaborador(nombre, correo), entidad(nombre)')
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
      };
    },

    /**
     * DS-01: guardarDocumentos(documentos). Cada documento es { tipo, contenido, tipoMime }:
     * el archivo se sube al bucket privado y en la tabla queda su tipo y su ruta (CL-01).
     * Ruta: incapacidades/{idIncapacidad}/{tipo}-{uuid}.{ext}. El nombre original no se usa:
     * puede traer datos personales o caracteres que Storage no acepta.
     * Si algo falla, se borran los archivos que ya se habían subido.
     * @returns {Promise<Array<{ tipo: string, archivo: string }>>}
     */
    async guardarDocumentos(idIncapacidad, documentos, creadoPor) {
      const guardados = [];
      try {
        for (const { tipo, contenido, tipoMime } of documentos) {
          const archivo = `incapacidades/${idIncapacidad}/${tipo}-${randomUUID()}.${EXTENSIONES[tipoMime]}`;
          await almacen.guardar(archivo, contenido, tipoMime);
          guardados.push({ tipo, archivo });
        }
        comprobar(
          await cliente
            .from('documento')
            .insert(guardados.map((documento) => aFila({ incapacidadId: idIncapacidad, ...documento, creadoPor }))),
        );
        return guardados;
      } catch (error) {
        await almacen.eliminar(guardados.map((documento) => documento.archivo)).catch(() => {});
        throw error;
      }
    },

    /** DS-01 (alt: correo): el original en físico queda pendiente (HU-04.CA2). */
    async marcarOriginalPendiente(idIncapacidad) {
      comprobar(await cliente.from('incapacidad').update({ original_pendiente: true }).eq('id', idIncapacidad));
    },
  };
}
