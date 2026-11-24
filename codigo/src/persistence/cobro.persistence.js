// Grupo `cobro` de la Base de datos — DS-06 (CU-10).
// Operaciones: obtenerDatosCobro (apoyo de la Vista), guardarEstado(cobrada, tiempoPago) (HU-13)
// guardarRechazo(causal) (HU-14) y guardarPago(valor, fechaPago) (HU-15).

const comprobar = ({ data, error }) => {
  if (error) throw error;
  return data;
};

export function crearPersistenciaCobro(cliente) {
  return {
    /**
     * La incapacidad con su colaborador, el nombre de la entidad, los datos del cobro, sus radicaciones y
     * sus pagos, de lo más antiguo a lo más reciente (la línea de tiempo del cobro sigue a la de la radicación).
     * null si no existe.
     */
    async obtenerDatosCobro(idIncapacidad) {
      const fila = comprobar(
        await cliente
          .from('incapacidad')
          .select(
            'id, tipo, fecha_inicio, dias_incapacidad, estado, causal_rechazo, fecha_rechazo, tiempo_pago, fecha_cobrada, fecha_archivo_preparado, ' +
              'colaborador(nombre), entidad(nombre), radicacion(id, radicado, evidencia, creado_en), ' +
              'pago(id, valor, fecha_pago)',
          )
          .eq('id', idIncapacidad)
          .order('id', { referencedTable: 'radicacion' })
          .order('id', { referencedTable: 'pago' })
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
        causalRechazo: fila.causal_rechazo,
        fechaRechazo: fila.fecha_rechazo,
        tiempoPago: fila.tiempo_pago,
        fechaCobrada: fila.fecha_cobrada,
        // Con el archivo preparado (HU-29, DA-59) ya no se registran pagos.
        archivoPreparado: fila.fecha_archivo_preparado != null,
        radicaciones: fila.radicacion.map((r) => ({
          idRadicacion: r.id,
          radicado: r.radicado,
          conEvidencia: Boolean(r.evidencia),
          fecha: r.creado_en,
        })),
        // numeric llega como número en el JSON; se pasa a texto con dos decimales para no perder centavos.
        pagos: fila.pago.map((p) => ({ idPago: p.id, valor: Number(p.valor).toFixed(2), fechaPago: p.fecha_pago })),
      };
    },

    /**
     * DS-06: guardarEstado(cobrada, tiempoPago) — HU-13. Un solo UPDATE condicionado a
     * `estado = transcrita`: si dos usuarios registran a la vez, solo uno lo cambia (DA-38).
     * @returns {Promise<boolean>} false si la incapacidad ya no estaba transcrita.
     */
    async guardarCobrada(idIncapacidad, { tiempoPago, fechaCobrada }) {
      const filas = comprobar(
        await cliente
          .from('incapacidad')
          .update({ estado: 'cobrada', tiempo_pago: tiempoPago, fecha_cobrada: fechaCobrada })
          .eq('id', idIncapacidad)
          .eq('estado', 'transcrita')
          .select('id'),
      );
      return filas.length === 1;
    },

    /**
     * DS-06: guardarRechazo(causal) — HU-14, con la fecha del rechazo. Un solo UPDATE condicionado a `estado = transcrita`,
     * como guardarCobrada: si la entidad «responde» dos veces a la vez, solo una respuesta queda (DA-39).
     * @returns {Promise<boolean>} false si la incapacidad ya no estaba transcrita.
     */
    async guardarRechazo(idIncapacidad, { causal, fechaRechazo }) {
      const filas = comprobar(
        await cliente
          .from('incapacidad')
          .update({ estado: 'rechazada', causal_rechazo: causal, fecha_rechazo: fechaRechazo })
          .eq('id', idIncapacidad)
          .eq('estado', 'transcrita')
          .select('id'),
      );
      return filas.length === 1;
    },

    /**
     * DS-06/07/08: guardarPago(valor, fechaPago) — HU-15. En una transacción (`registrar_pago`) pone
     * `estado = pagada` y guarda el pago, solo si estaba cobrada o pagada (DA-08, DA-40).
     * @param {{ valor: string, fechaPago: string }} pago valor como texto «1234567.50».
     * @returns {Promise<number | null>} id del pago; null si el estado ya no lo permitía.
     */
    async guardarPago(idIncapacidad, { valor, fechaPago }, creadoPor) {
      const id = comprobar(
        await cliente.rpc('registrar_pago', {
          p_incapacidad_id: idIncapacidad,
          p_valor: valor,
          p_fecha_pago: fechaPago,
          p_creado_por: creadoPor,
        }),
      );
      return id == null ? null : Number(id);
    },
  };
}
