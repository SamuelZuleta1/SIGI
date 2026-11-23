// Grupo `reconocimiento` de la Base de datos — DS-09 (CU-13).
// Operaciones: consultarParaReconocimiento y obtenerDatosReconocimiento (apoyo de la Vista) y
// guardarCalculo (HU-21): guarda el IBC, el valor de la empresa, el de la EPS y el trámite de pensión (DA-10).

const comprobar = ({ data, error }) => {
  if (error) throw error;
  return data;
};

const aDatos = (f) => ({
  idIncapacidad: f.id,
  colaborador: f.colaborador.nombre,
  entidad: f.entidad.nombre,
  tipo: f.tipo,
  fechaInicio: f.fecha_inicio,
  diasIncapacidad: f.dias_incapacidad,
  estado: f.estado,
  ibc: f.ibc,
  valorEmpresa: f.valor_empresa,
  valorEPS: f.valor_eps,
  tramitePension: f.tramite_pension,
  fechaCalculo: f.fecha_calculo,
});

const COLUMNAS =
  'id, tipo, fecha_inicio, dias_incapacidad, estado, ibc, valor_empresa, valor_eps, tramite_pension, fecha_calculo, colaborador(nombre), entidad(nombre)';

export function crearPersistenciaReconocimiento(cliente) {
  return {
    /** Las incapacidades más recientes con su cálculo (si lo tienen), para elegir una. `total` cuenta todas. */
    async consultarParaReconocimiento(limite) {
      const respuesta = await cliente
        .from('incapacidad')
        .select(COLUMNAS, { count: 'exact' })
        .order('fecha_inicio', { ascending: false })
        .order('id', { ascending: false })
        .limit(limite);
      const filas = comprobar(respuesta);
      return { total: respuesta.count ?? filas.length, filas: filas.map(aDatos) };
    },

    /** La incapacidad con su cálculo guardado. null si no existe. */
    async obtenerDatosReconocimiento(idIncapacidad) {
      const fila = comprobar(await cliente.from('incapacidad').select(COLUMNAS).eq('id', idIncapacidad).maybeSingle());
      return fila ? aDatos(fila) : null;
    },

    /**
     * DS-09: guardarCalculo(ibc, valorEmpresa, valorEPS, tramitePension) — HU-21. Los valores van como texto
     * «1234567.50» (numeric(14,2)). Un nuevo cálculo reemplaza al anterior y guarda quién lo hizo y cuándo (DA-23).
     */
    async guardarCalculo(idIncapacidad, { ibc, valorEmpresa, valorEPS, tramitePension }, por) {
      comprobar(
        await cliente
          .from('incapacidad')
          .update({
            ibc,
            valor_empresa: valorEmpresa,
            valor_eps: valorEPS,
            tramite_pension: tramitePension,
            fecha_calculo: new Date().toISOString(),
            calculo_por: por,
          })
          .eq('id', idIncapacidad),
      );
    },
  };
}
