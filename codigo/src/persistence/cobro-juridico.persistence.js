// Grupo `cobro-juridico` de la Base de datos — DS-08 (CU-12).
// Operaciones: obtenerDatosRequerimientos (apoyo de la Vista), guardarRequerimiento (HU-18.CA1) y guardarTraslado (HU-19.CA1).

const comprobar = ({ data, error }) => {
  if (error) throw error;
  return data;
};

export function crearPersistenciaCobroJuridico(cliente) {
  return {
    /**
     * La incapacidad con lo que necesita su cobro persuasivo: datos del cobro y requerimientos, del más antiguo
     * al más reciente. null si no existe.
     */
    async obtenerDatosRequerimientos(idIncapacidad) {
      const fila = comprobar(
        await cliente
          .from('incapacidad')
          .select(
            'id, tipo, fecha_inicio, dias_incapacidad, estado, decision, tiempo_pago, fecha_cobrada, motivo_traslado, fecha_traslado, ' +
              'colaborador(nombre), entidad(nombre), requerimiento(id, fundamentos, creado_en)',
          )
          .eq('id', idIncapacidad)
          .order('id', { referencedTable: 'requerimiento' })
          .maybeSingle(),
      );
      if (!fila) return null;
      return {
        idIncapacidad: fila.id,
        colaborador: fila.colaborador.nombre,
        entidad: fila.entidad.nombre,
        tipo: fila.tipo,
        fechaInicio: fila.fecha_inicio,
        diasIncapacidad: fila.dias_incapacidad,
        estado: fila.estado,
        decision: fila.decision,
        tiempoPago: fila.tiempo_pago,
        fechaCobrada: fila.fecha_cobrada,
        motivoTraslado: fila.motivo_traslado,
        fechaTraslado: fila.fecha_traslado,
        requerimientos: fila.requerimiento.map((r) => ({
          idRequerimiento: r.id,
          fundamentos: r.fundamentos,
          registrado: r.creado_en,
        })),
      };
    },

    /**
     * DS-08: guardarRequerimiento(fundamentos) — HU-18.CA1. Con `registrar_requerimiento`, solo si la incapacidad
     * sigue cobrada y sin dar de baja (DA-43).
     * @returns {Promise<number | null>} id del requerimiento; null si ya no estaba pendiente de pago.
     */
    async guardarRequerimiento(idIncapacidad, fundamentos, creadoPor) {
      const id = comprobar(
        await cliente.rpc('registrar_requerimiento', {
          p_incapacidad_id: idIncapacidad,
          p_fundamentos: fundamentos,
          p_creado_por: creadoPor,
        }),
      );
      return id == null ? null : Number(id);
    },

    /**
     * DS-08: guardarTraslado(motivo) — HU-19.CA1. Con `trasladar_a_cartera`, solo si la incapacidad sigue cobrada,
     * sin dar de baja y sin trasladar antes (DA-44). `fecha` es AAAA-MM-DD (hoy en Colombia).
     * @returns {Promise<boolean>} false si el estado ya no lo permitía.
     */
    async guardarTraslado(idIncapacidad, motivo, fecha) {
      return comprobar(
        await cliente.rpc('trasladar_a_cartera', { p_incapacidad_id: idIncapacidad, p_motivo: motivo, p_fecha: fecha }),
      ) === true;
    },

    /** Deshace el traslado recién guardado (si el aviso a Cartera falló). Solo borra el que tiene ese motivo. */
    async deshacerTraslado(idIncapacidad, motivo) {
      comprobar(
        await cliente
          .from('incapacidad')
          .update({ motivo_traslado: null, fecha_traslado: null })
          .eq('id', idIncapacidad)
          .eq('motivo_traslado', motivo),
      );
    },
  };
}
