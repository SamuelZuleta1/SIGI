// Grupo `estados` de la Base de datos — DS-05 (CU-08).
// Operación: consultarIncapacidades(filtros) → listaIncapacidades (HU-11). Solo lectura.
import { ESTADOS_INCAPACIDAD } from '../models/incapacidad.model.js';

const comprobar = ({ data, count, error }) => {
  if (error) throw error;
  return { data, count };
};

/**
 * Aplica los filtros comunes (DA-20) a una consulta de `incapacidad`.
 * estado: 'registrada' = sin valor (null); colaboradores: lista de ids o null (sin filtro).
 */
function filtrar(consulta, { estado, entidad, colaboradores, desde, hasta }) {
  let q = consulta;
  if (estado === 'registrada') q = q.is('estado', null);
  else if (estado) q = q.eq('estado', estado);
  if (entidad) q = q.eq('entidad_id', entidad);
  if (colaboradores) q = q.in('colaborador_id', colaboradores);
  if (desde) q = q.gte('fecha_inicio', desde);
  if (hasta) q = q.lte('fecha_inicio', hasta);
  return q;
}

export function crearPersistenciaEstados(cliente) {
  return {
    /** Colaboradores para buscar por nombre (id y nombre). */
    async consultarColaboradores() {
      return comprobar(await cliente.from('colaborador').select('id, nombre')).data;
    },

    /**
     * DS-05: consultarIncapacidades(filtros) → listaIncapacidades, de la más reciente a la más antigua
     * por fecha de inicio. `total` cuenta todas las que cumplen los filtros, aunque se devuelvan `limite`.
     */
    async consultarIncapacidades(filtros, limite) {
      const { data, count } = comprobar(
        await filtrar(
          cliente
            .from('incapacidad')
            .select('id, tipo, fecha_inicio, dias_incapacidad, estado, colaborador(nombre), entidad(nombre)', { count: 'exact' }),
          filtros,
        )
          .order('fecha_inicio', { ascending: false })
          .order('id', { ascending: false })
          .limit(limite),
      );
      return {
        total: count ?? data.length,
        filas: data.map((f) => ({
          idIncapacidad: f.id,
          colaborador: f.colaborador.nombre,
          tipo: f.tipo,
          entidad: f.entidad.nombre,
          fechaInicio: f.fecha_inicio,
          diasIncapacidad: f.dias_incapacidad,
          estado: f.estado,
        })),
      };
    },

    /** Cuántas incapacidades hay en cada estado con los demás filtros (para las pestañas). */
    async contarPorEstado(filtros) {
      const estados = ['registrada', ...ESTADOS_INCAPACIDAD];
      const cuentas = await Promise.all(
        estados.map(async (estado) => {
          const { count } = comprobar(
            await filtrar(cliente.from('incapacidad').select('id', { count: 'exact', head: true }), { ...filtros, estado }),
          );
          return [estado, count ?? 0];
        }),
      );
      return Object.fromEntries(cuentas);
    },
  };
}
