// Grupo `estadisticas` de la Base de datos — panel de estadísticas e informes de gestión. Solo lectura y sin migración:
// usa las columnas que ya existen. La cartera pendiente reutiliza consultarCobradas (seguimiento, HU-16).
import { BLOQUE } from './alertas.persistence.js';
import { VENTANA } from './reportes.persistence.js';
import { sumarIntervalo } from '../servicios/dias-habiles.js';

const comprobar = ({ data, error }) => {
  if (error) throw error;
  return data;
};

/** Lee todas las filas de una consulta en bloques (la API devuelve como máximo BLOQUE filas). */
async function leerEnBloques(crearConsulta) {
  const filas = [];
  for (;;) {
    const inicio = filas.length;
    const bloque = comprobar(await crearConsulta().range(inicio, inicio + BLOQUE - 1));
    if (bloque.length === 0) break;
    filas.push(...bloque);
    if (bloque.length < BLOQUE) break;
  }
  return filas;
}

const COLUMNAS_INCAPACIDAD =
  'id, colaborador_id, entidad_id, tipo, fecha_inicio, dias_incapacidad, fecha_recepcion, estado, fecha_cobrada, ' +
  'fecha_rechazo, tiempo_pago, decision, caso_id, dias_acumulados, colaborador(nombre), entidad(nombre)';

export function crearPersistenciaEstadisticas(cliente) {
  return {
    /**
     * Las incapacidades que pueden tener algún día en [desde, hasta] (como consultarDatosReporte, HU-27): las que empiezan
     * en los VENTANA días anteriores o dentro del rango, y las más antiguas que duran más de VENTANA días. El Control
     * deja solo las que de verdad tocan cada mes.
     */
    async consultarDatosEstadisticas(desde, hasta) {
      const limite = sumarIntervalo(desde, { dias: -VENTANA });
      const leer = (filtrar) => leerEnBloques(() => filtrar(cliente.from('incapacidad').select(COLUMNAS_INCAPACIDAD)).order('id'));
      const [recientes, largas] = await Promise.all([
        leer((q) => q.gte('fecha_inicio', limite).lte('fecha_inicio', hasta)),
        leer((q) => q.lt('fecha_inicio', limite).gt('dias_incapacidad', VENTANA)),
      ]);
      return [...largas, ...recientes].map((f) => ({
        idIncapacidad: f.id,
        idColaborador: f.colaborador_id,
        colaborador: f.colaborador.nombre,
        idEntidad: f.entidad_id,
        entidad: f.entidad.nombre,
        tipo: f.tipo,
        fechaInicio: f.fecha_inicio,
        diasIncapacidad: f.dias_incapacidad,
        fechaRecepcion: f.fecha_recepcion,
        estado: f.estado ?? 'registrada',
        fechaCobrada: f.fecha_cobrada,
        fechaRechazo: f.fecha_rechazo,
        tiempoPago: f.tiempo_pago,
        decision: f.decision,
        casoId: f.caso_id,
        diasAcumulados: f.dias_acumulados,
      }));
    },

    /** Los pagos vigentes (no anulados, HU-15) con fecha de pago en [desde, hasta], con su incapacidad y entidad. */
    async consultarPagosDelPeriodo(desde, hasta) {
      const filas = await leerEnBloques(() =>
        cliente
          .from('pago')
          .select('id, incapacidad_id, valor, fecha_pago, incapacidad(entidad_id, fecha_cobrada, colaborador(nombre), entidad(nombre))')
          .is('anulado_en', null)
          .gte('fecha_pago', desde)
          .lte('fecha_pago', hasta)
          .order('id'),
      );
      return filas.map((f) => ({
        idPago: f.id,
        idIncapacidad: f.incapacidad_id,
        valor: Number(f.valor).toFixed(2),
        fechaPago: f.fecha_pago,
        idEntidad: f.incapacidad.entidad_id,
        entidad: f.incapacidad.entidad.nombre,
        colaborador: f.incapacidad.colaborador.nombre,
        fechaCobrada: f.incapacidad.fecha_cobrada,
      }));
    },
  };
}
