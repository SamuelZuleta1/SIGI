// Grupo `conciliacion` de la Base de datos — DS-11 (CU-15).
// Operaciones: guardarPagosConsignados (HU-25), con eliminarPagosConsignados para deshacer si el aviso falla, y
// consultarPagosConsignados (apoyo de la Vista). HU-26: obtenerPagosConsignados(entidad), guardarConciliacion(detalle)
// y guardarSaldosPendientes(saldos) (las dos en la transacción `registrar_conciliacion`, DA-56), con
// deshacerConciliacion; y de apoyo, consultarPagosPorConciliar, contarPorIdentificar, consultarConciliaciones y
// consultarConciliacion.

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

const aConciliacion = (f) => ({
  id: f.id,
  entidadId: f.entidad_id,
  entidad: f.entidad.nombre,
  detalle: f.detalle,
  saldosPendientes: f.saldos_pendientes,
  creadoEn: f.creado_en,
});

export function crearPersistenciaConciliacion(cliente) {
  /** DA-56: conciliación, enlaces y marca `conciliado` en una transacción. null si lo comparado ya cambió. */
  const registrar = async (entidadId, { consignadosVistos, pares, detalle, saldos }, por) =>
    comprobar(
      await cliente.rpc('registrar_conciliacion', {
        p_entidad_id: entidadId,
        p_consignados_vistos: consignadosVistos,
        p_pares: pares,
        p_detalle: detalle,
        p_saldos: saldos,
        p_creado_por: por,
      }),
    );

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

    /** DS-11: obtenerPagosConsignados(entidad) — HU-26. Los de la entidad que siguen por identificar, del más antiguo al más reciente. */
    async obtenerPagosConsignados(entidadId) {
      const filas = comprobar(
        await cliente
          .from('pago_consignado')
          .select('id, entidad_id, colaborador, dias_pagados, valor, creado_en, entidad(nombre)')
          .eq('entidad_id', entidadId)
          .is('conciliacion_id', null)
          .order('id'),
      );
      return filas.map(aDatos);
    },

    /**
     * Apoyo de HU-26 (DA-11): los pagos registrados (HU-15) de incapacidades de la entidad que aún no se conciliaron,
     * para que el auxiliar los elija. Del más antiguo al más reciente.
     */
    async consultarPagosPorConciliar(entidadId) {
      const filas = comprobar(
        await cliente
          .from('pago')
          .select('id, valor, fecha_pago, incapacidad!inner(id, entidad_id, colaborador(nombre))')
          .eq('incapacidad.entidad_id', entidadId)
          .is('conciliacion_id', null)
          .order('fecha_pago')
          .order('id'),
      );
      return filas.map((f) => ({
        idPago: f.id,
        idIncapacidad: f.incapacidad.id,
        colaborador: f.incapacidad.colaborador.nombre,
        valor: f.valor,
        fechaPago: f.fecha_pago,
      }));
    },

    /** Apoyo de HU-26: cuántos pagos consignados siguen por identificar, por entidad: { [entidadId]: n }. */
    async contarPorIdentificar() {
      const filas = comprobar(await cliente.from('pago_consignado').select('entidad_id').is('conciliacion_id', null));
      return filas.reduce((cuenta, f) => ({ ...cuenta, [f.entidad_id]: (cuenta[f.entidad_id] ?? 0) + 1 }), {});
    },

    /** DS-11: guardarConciliacion(detalle) — HU-26.CA2, todos los pagos quedaron identificados. @returns {Promise<number|null>} */
    async guardarConciliacion(entidadId, datos, por) {
      return registrar(entidadId, datos, por);
    },

    /**
     * DS-11: guardarSaldosPendientes(saldos) — HU-26.CA3. Los saldos van en la misma fila de la conciliación, junto
     * con lo que sí se identificó (DA-56). @returns {Promise<number|null>}
     */
    async guardarSaldosPendientes(entidadId, datos, por) {
      return registrar(entidadId, datos, por);
    },

    /** Deshace guardarConciliacion o guardarSaldosPendientes cuando el correo a Contabilidad falla. */
    async deshacerConciliacion(id) {
      comprobar(await cliente.rpc('deshacer_conciliacion', { p_id: id }));
    },

    /** Las conciliaciones más recientes primero. */
    async consultarConciliaciones(limite) {
      const filas = comprobar(
        await cliente
          .from('conciliacion')
          .select('id, entidad_id, detalle, saldos_pendientes, creado_en, entidad(nombre)')
          .order('creado_en', { ascending: false })
          .order('id', { ascending: false })
          .limit(limite),
      );
      return filas.map(aConciliacion);
    },

    /** Una conciliación con su detalle y sus saldos; null si no existe. */
    async consultarConciliacion(id) {
      const fila = comprobar(
        await cliente
          .from('conciliacion')
          .select('id, entidad_id, detalle, saldos_pendientes, creado_en, entidad(nombre)')
          .eq('id', id)
          .maybeSingle(),
      );
      return fila ? aConciliacion(fila) : null;
    },
  };
}
