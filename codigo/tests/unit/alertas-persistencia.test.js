// HU-12 — consultarPlazos lee en bloques: la API de Supabase corta cada respuesta en max_rows filas.
import { describe, expect, it } from 'vitest';
import { BLOQUE, crearPersistenciaAlertas } from '../../src/persistence/alertas.persistence.js';

const fila = (id) => ({
  id,
  tipo: 'enfermedad_general',
  fecha_inicio: '2026-11-03',
  dias_incapacidad: 5,
  fecha_recepcion: '2026-11-04',
  fecha_nacimiento: null,
  estado: null,
  documentacion_completa: null,
  fecha_aviso_faltantes: null,
  segundo_llamado: false,
  colaborador: { nombre: `Colaborador ${id}` },
  entidad: { nombre: 'Nueva EPS', plazo_transcripcion: '1 year', plazo_transcripcion_transito: null },
});

// Cliente falso: como PostgREST, devuelve el rango pedido pero nunca más de `maximo` filas.
function clienteFalso(total, maximo) {
  const todas = Array.from({ length: total }, (_, i) => fila(i + 1));
  const rangos = [];
  const consulta = {
    select: () => consulta,
    or: () => consulta,
    order: () => consulta,
    range: async (desde, hasta) => {
      rangos.push([desde, hasta]);
      return { data: todas.slice(desde, Math.min(hasta + 1, desde + maximo)), error: null };
    },
  };
  return { rangos, from: () => consulta };
}

describe('HU-12 — consultarPlazos (persistencia)', () => {
  it('trae todas las filas aunque pasen del máximo por respuesta', async () => {
    const cliente = clienteFalso(BLOQUE + 5, BLOQUE);
    const filas = await crearPersistenciaAlertas(cliente).consultarPlazos();
    expect(filas).toHaveLength(BLOQUE + 5);
    expect(filas.at(-1)).toMatchObject({ idIncapacidad: BLOQUE + 5, colaborador: `Colaborador ${BLOQUE + 5}` });
    expect(cliente.rangos).toEqual([[0, BLOQUE - 1], [BLOQUE, 2 * BLOQUE - 1], [BLOQUE + 5, 2 * BLOQUE + 4]]);
  });

  it('sirve aunque el servidor entregue menos filas que el bloque pedido', async () => {
    const filas = await crearPersistenciaAlertas(clienteFalso(250, 100)).consultarPlazos();
    expect(filas.map((f) => f.idIncapacidad)).toEqual(Array.from({ length: 250 }, (_, i) => i + 1));
  });

  it('propaga el error de Supabase', async () => {
    const consulta = { select: () => consulta, or: () => consulta, order: () => consulta, range: async () => ({ data: null, error: new Error('caída') }) };
    await expect(crearPersistenciaAlertas({ from: () => consulta }).consultarPlazos()).rejects.toThrow('caída');
  });
});
