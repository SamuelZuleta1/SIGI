// Grupo `seguimiento` de la Base de datos — DS-07 (CU-11).
// Operaciones: consultarCobradas (HU-16.CA1), obtenerDatosSeguimiento (apoyo de la Vista), guardarSeguimiento (HU-16.CA3)
// y guardarAcuerdo (HU-17.CA2).
import { randomUUID } from 'node:crypto';
import { crearAlmacenDocumentos } from './almacen-documentos.js';
import { BLOQUE } from './alertas.persistence.js';

const EXTENSIONES = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png' };

const comprobar = ({ data, error }) => {
  if (error) throw error;
  return data;
};

export function crearPersistenciaSeguimiento(cliente, almacen = crearAlmacenDocumentos(cliente)) {
  return {
    /**
     * DS-07: consultarCobradas() → las incapacidades cobradas que no se dieron de baja (DA-18), con la fecha de su
     * último seguimiento y su último acuerdo de pago (HU-17). Se leen en bloques por el máximo de filas de la API (como consultarPlazos).
     */
    async consultarCobradas() {
      const filas = [];
      for (;;) {
        const desde = filas.length;
        const bloque = comprobar(
          await cliente
            .from('incapacidad')
            .select(
              'id, tipo, fecha_inicio, dias_incapacidad, estado, decision, tiempo_pago, fecha_cobrada, ' +
                'colaborador(nombre), entidad(nombre), seguimiento(creado_en), acuerdo_pago(fecha, valor)',
            )
            .eq('estado', 'cobrada')
            .or('decision.is.null,decision.neq.dar_de_baja')
            .order('id')
            .order('creado_en', { referencedTable: 'seguimiento', ascending: false })
            .limit(1, { referencedTable: 'seguimiento' })
            .order('id', { referencedTable: 'acuerdo_pago', ascending: false })
            .limit(1, { referencedTable: 'acuerdo_pago' })
            .range(desde, desde + BLOQUE - 1),
        );
        if (bloque.length === 0) break;
        filas.push(...bloque);
      }
      return filas.map((f) => ({
        idIncapacidad: f.id,
        colaborador: f.colaborador.nombre,
        entidad: f.entidad.nombre,
        tipo: f.tipo,
        fechaInicio: f.fecha_inicio,
        diasIncapacidad: f.dias_incapacidad,
        estado: f.estado,
        decision: f.decision,
        tiempoPago: f.tiempo_pago,
        fechaCobrada: f.fecha_cobrada,
        ultimoSeguimiento: f.seguimiento[0]?.creado_en ?? null,
        ultimoAcuerdo: f.acuerdo_pago[0] ? { fecha: f.acuerdo_pago[0].fecha, valor: Number(f.acuerdo_pago[0].valor).toFixed(2) } : null,
      }));
    },

    /**
     * La incapacidad con lo que necesita su seguimiento: datos del cobro, seguimientos y acuerdos de pago,
     * de lo más antiguo a lo más reciente. null si no existe.
     */
    async obtenerDatosSeguimiento(idIncapacidad) {
      const fila = comprobar(
        await cliente
          .from('incapacidad')
          .select(
            'id, tipo, fecha_inicio, dias_incapacidad, estado, decision, tiempo_pago, fecha_cobrada, ' +
              'colaborador(nombre), entidad(nombre), seguimiento(id, creado_en), acuerdo_pago(id, fecha, valor, creado_en)',
          )
          .eq('id', idIncapacidad)
          .order('id', { referencedTable: 'seguimiento' })
          .order('id', { referencedTable: 'acuerdo_pago' })
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
        seguimientos: fila.seguimiento.map((s) => ({ idSeguimiento: s.id, fecha: s.creado_en })),
        acuerdos: fila.acuerdo_pago.map((a) => ({
          idAcuerdo: a.id,
          fecha: a.fecha,
          valor: Number(a.valor).toFixed(2),
          registrado: a.creado_en,
        })),
      };
    },

    /**
     * DS-07: guardarSeguimiento(evidencia) — HU-16.CA3. Sube la evidencia al bucket privado
     * (incapacidades/{id}/seguimiento-{uuid}.{ext}) y la registra con `registrar_seguimiento`, solo si la
     * incapacidad sigue cobrada y sin dar de baja. Si no se registra, borra el archivo subido.
     * @returns {Promise<number | null>} id del seguimiento; null si ya no estaba pendiente de pago.
     */
    async guardarSeguimiento(idIncapacidad, { contenido, tipoMime }, creadoPor) {
      const evidencia = `incapacidades/${idIncapacidad}/seguimiento-${randomUUID()}.${EXTENSIONES[tipoMime]}`;
      await almacen.guardar(evidencia, contenido, tipoMime);
      try {
        const id = comprobar(
          await cliente.rpc('registrar_seguimiento', {
            p_incapacidad_id: idIncapacidad,
            p_evidencia: evidencia,
            p_creado_por: creadoPor,
          }),
        );
        if (id == null) await almacen.eliminar([evidencia]).catch(() => {});
        return id == null ? null : Number(id);
      } catch (error) {
        await almacen.eliminar([evidencia]).catch(() => {});
        throw error;
      }
    },

    /**
     * DS-07: guardarAcuerdo(acuerdo) — HU-17.CA2. Con `registrar_acuerdo`, solo si la incapacidad sigue cobrada y
     * sin dar de baja (DA-42). `valor` como texto «1234567.50».
     * @returns {Promise<number | null>} id del acuerdo; null si ya no estaba pendiente de pago.
     */
    async guardarAcuerdo(idIncapacidad, { fecha, valor }, creadoPor) {
      const id = comprobar(
        await cliente.rpc('registrar_acuerdo', {
          p_incapacidad_id: idIncapacidad,
          p_fecha: fecha,
          p_valor: valor,
          p_creado_por: creadoPor,
        }),
      );
      return id == null ? null : Number(id);
    },

    /** Un seguimiento (sin el archivo), o null si no existe. */
    async consultarSeguimiento(idSeguimiento) {
      const fila = comprobar(
        await cliente.from('seguimiento').select('id, incapacidad_id, evidencia').eq('id', idSeguimiento).maybeSingle(),
      );
      return fila && { idSeguimiento: fila.id, idIncapacidad: fila.incapacidad_id, evidencia: fila.evidencia };
    },
  };
}
