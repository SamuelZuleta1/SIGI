// Grupo `conciliacion` de la Base de datos — DS-11 (CU-15).
// Operaciones: guardarPagosConsignados (HU-25), con eliminarPagosConsignados para deshacer si el aviso falla, y
// consultarPagosConsignados (apoyo de la Vista). obtenerPagosConsignados, guardarConciliacion y
// guardarSaldosPendientes (HU-26) llegan en T-26.

const comprobar = ({ data, error }) => {
  if (error) throw error;
  return data;
};

const aDatos = (f) => ({
  id: f.id,
  entidadId: f.entidad_id,
  entidad: f.entidad.nombre,
  colaborador: f.colaborador,
  diasPagados: f.dias_pagados,
  valor: f.valor,
  creadoEn: f.creado_en,
});

export function crearPersistenciaConciliacion(cliente) {
  return {
    /**
     * DS-11: guardarPagosConsignados(listaPagos) — HU-25. Toda la lista en una sola sentencia INSERT: se guarda
     * completa o no se guarda nada. `colaborador` es texto (P-B); `valor` va como «1234567.50» (numeric(14,2)).
     * `por` es quien registra (DA-23).
     * @returns {Promise<number[]>} los ids guardados.
     */
    async guardarPagosConsignados(entidadId, pagos, por) {
      const filas = comprobar(
        await cliente
          .from('pago_consignado')
          .insert(pagos.map((p) => ({
            entidad_id: entidadId,
            colaborador: p.colaborador,
            dias_pagados: p.diasPagados,
            valor: p.valor,
            creado_por: por,
          })))
          .select('id'),
      );
      return filas.map((f) => f.id);
    },

    /** Deshace guardarPagosConsignados cuando el aviso al auxiliar falla. */
    async eliminarPagosConsignados(ids) {
      if (ids.length === 0) return;
      comprobar(await cliente.from('pago_consignado').delete().in('id', ids));
    },

    /** Los pagos consignados más recientes primero; los de una misma lista quedan juntos (mismo `creado_en`). */
    async consultarPagosConsignados(limite) {
      const filas = comprobar(
        await cliente
          .from('pago_consignado')
          .select('id, entidad_id, colaborador, dias_pagados, valor, creado_en, entidad(nombre)')
          .order('creado_en', { ascending: false })
          .order('id', { ascending: false })
          .limit(limite),
      );
      return filas.map(aDatos);
    },
  };
}
