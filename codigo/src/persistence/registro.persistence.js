// Grupo `registro` de la Base de datos — DS-01 (CU-01, CU-02).
// Operaciones: guardarIncapacidad. (guardarDocumentos y marcarOriginalPendiente llegan con HU-04.)
// Apoyo: consultarEntidades, para el formulario de registro (DA-03).
import { aFila } from './conversion.js';

const comprobar = ({ data, error }) => {
  if (error) throw error;
  return data;
};

export function crearPersistenciaRegistro(cliente) {
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
  };
}
