// Grupo `cobro-juridico` de la Base de datos — DS-08 (CU-12).
// Operaciones: obtenerDatosRequerimientos (apoyo de la Vista) y guardarRequerimiento (HU-18.CA1).

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
            'id, tipo, fecha_inicio, dias_incapacidad, estado, decision, tiempo_pago, fecha_cobrada, ' +
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
  };
}
