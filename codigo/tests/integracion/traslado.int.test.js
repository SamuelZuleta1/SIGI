// HU-19 contra Supabase (nube): trasladar_a_cartera (migraciones 20261122054704 y, auditoría decisión 4A,
// 20261125193654_traslado_causales) guarda la causal, el motivo y la fecha solo sin dar de baja ni trasladar antes, con
// mínimo 2 requerimientos y la condición de la causal (180 días desde fecha_cobrada, deterioro en una cobrada, rechazo
// en una rechazada); el pago posterior usa registrarPago, también en una rechazada recuperada.
// Requisitos: proyecto vinculado, migraciones aplicadas y `npm run db:usuarios`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUCKET_DOCUMENTOS, crearClienteServidor } from '../../src/config/supabase.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearBaseDeDatos } from '../../src/persistence/base-de-datos.js';
import { crearCorreoFalso, DESTINATARIOS } from '../helpers/correo-falso.js';
import { formularioDeRegistro, PDF, diasDistintos } from '../helpers/fabricas.js';

const diasDelCaso = diasDistintos(); // HU-03: sin duplicados entre las pruebas del archivo

const servidor = crearClienteServidor();
const baseDeDatos = crearBaseDeDatos(servidor);
const { correo, enviados } = crearCorreoFalso();
let hoy = '2026-11-21';
const control = crearControlIncapacidades({ baseDeDatos, correo, hoy: () => hoy });

const correoColaborador = `prueba.traslado.${Date.now()}@sigi.test`;
const ids = [];
let receptor;
let auxiliar;

/** Cobrada el 21 nov 2026 (prometida 1 dic); hoy, 4 dic. Con `requerimientos` registrados. */
const registrarCobrada = async ({ requerimientos = 2 } = {}) => {
  hoy = '2026-11-21';
  const { idIncapacidad } = await control.registrarIncapacidad(formularioDeRegistro({ diasIncapacidad: diasDelCaso(), correoColaborador }), receptor);
  ids.push(idIncapacidad);
  await control.registrarRadicacion(idIncapacidad, { radicado: 'RAD-TRA', evidencia: PDF }, auxiliar);
  await control.registrarCobrada(idIncapacidad, { tiempoPago: '10' });
  hoy = '2026-12-04';
  for (let n = 1; n <= requerimientos; n++) {
    await control.registrarRequerimiento(idIncapacidad, { fundamentos: `Requerimiento número ${n} de cobro.` }, auxiliar);
  }
  return idIncapacidad;
};
const traslado = (id, causal, motivo, fecha = '2026-12-04') => baseDeDatos.guardarTraslado(id, { causal, motivo }, fecha);
const fila = async (id) =>
  (await servidor.from('incapacidad').select('estado, causal_traslado, motivo_traslado, fecha_traslado').eq('id', id).single()).data;

beforeAll(async () => {
  const { data, error } = await servidor.from('usuario').select('id, correo, rol').eq('correo', 'receptor1@sigi.test').maybeSingle();
  if (error || !data) throw new Error('Faltan los usuarios de demostración: ejecute `npm run db:usuarios`');
  receptor = data;
  const aux = await servidor.from('usuario').select('id, correo, rol').eq('rol', 'auxiliar').limit(1).maybeSingle();
  if (aux.error || !aux.data) throw new Error('Falta un usuario auxiliar de demostración: ejecute `npm run db:usuarios`');
  auxiliar = aux.data;
});

afterAll(async () => {
  if (ids.length) {
    const radicaciones = await servidor.from('radicacion').select('evidencia').in('incapacidad_id', ids);
    const rutas = (radicaciones.data ?? []).map((r) => r.evidencia).filter(Boolean);
    if (rutas.length) await servidor.storage.from(BUCKET_DOCUMENTOS).remove(rutas);
    await servidor.from('incapacidad').delete().in('id', ids);
  }
  await servidor.from('colaborador').delete().eq('correo', correoColaborador);
});

describe('HU-19 — traslado a Cartera y Jurídica (base de datos)', () => {
  it('HU-19.CA1 — guarda la causal, el motivo y la fecha, y avisa a Cartera con la causal', async () => {
    const id = await registrarCobrada();
    const antes = enviados.length;
    expect(await control.trasladarACartera(id, { causal: 'deterioro', motivo: 'La entidad está en liquidación' })).toMatchObject({ requerimientos: 2, causal: 'deterioro' });
    expect(enviados.slice(antes).map((m) => m.to)).toEqual([DESTINATARIOS.cartera]);
    expect(enviados.at(-1).text).toContain('Causal: Deterioro crediticio de la entidad');
    expect(await fila(id)).toEqual({ estado: 'cobrada', causal_traslado: 'deterioro', motivo_traslado: 'La entidad está en liquidación', fecha_traslado: '2026-12-04' });
  });

  it('4A — la función exige 2 requerimientos para toda causal', async () => {
    const id = await registrarCobrada({ requerimientos: 1 });
    expect(await traslado(id, 'deterioro', 'Con un solo requerimiento')).toBe(false);
    await control.registrarRequerimiento(id, { fundamentos: 'Requerimiento número 2 de cobro.' }, auxiliar);
    expect(await traslado(id, 'deterioro', 'Ya con dos requerimientos')).toBe(true);
  });

  it('4A — 180 días desde fecha_cobrada: el día 179 no, el 180 sí; deterioro sin demora sí', async () => {
    const id = await registrarCobrada();
    expect(await traslado(id, '180_dias', 'Sin pago', '2027-05-19')).toBe(false);
    expect(await traslado(id, '180_dias', 'Sin pago', '2027-05-20')).toBe(true);
    const otra = await registrarCobrada();
    expect(await traslado(otra, 'deterioro', 'En liquidación', '2026-11-25')).toBe(true); // antes de la fecha prometida
  });

  it('4A — una rechazada: admite requerimientos, solo se traslada por rechazo, y la recuperada admite el pago', async () => {
    hoy = '2026-11-21';
    const { idIncapacidad: id } = await control.registrarIncapacidad(formularioDeRegistro({ diasIncapacidad: diasDelCaso(), correoColaborador }), receptor);
    ids.push(id);
    await control.registrarRadicacion(id, { radicado: 'RAD-REC', evidencia: PDF }, auxiliar);
    await control.registrarRechazo(id, { causal: 'Falta la epicrisis del paciente' });
    hoy = '2026-12-04';
    for (const n of [1, 2]) expect(await baseDeDatos.guardarRequerimiento(id, `Reclamo número ${n} por el rechazo.`, auxiliar.id)).not.toBeNull();
    expect(await traslado(id, 'deterioro', 'No aplica a una rechazada')).toBe(false);
    expect(await traslado(id, '180_dias', 'No aplica a una rechazada')).toBe(false);
    expect(await traslado(id, 'rechazo', 'La entidad no reconoce la epicrisis')).toBe(true);
    expect(await baseDeDatos.guardarDecision(id, 'recuperar', '2026-12-05')).toBe(true);

    const pago = await baseDeDatos.guardarPago(id, { valor: '500000.00', fechaPago: '2026-12-06' }, auxiliar.id);
    expect(pago).not.toBeNull();
    expect((await fila(id)).estado).toBe('pagada'); // sin tiempo de pago: nunca fue cobrada
    expect(await baseDeDatos.anularPago(pago, 'Valor mal digitado en el registro', auxiliar.id)).toBe(true);
    expect((await fila(id)).estado).toBe('rechazada');
  });

  it('una rechazada sin traslado no admite el pago', async () => {
    hoy = '2026-11-21';
    const { idIncapacidad: id } = await control.registrarIncapacidad(formularioDeRegistro({ diasIncapacidad: diasDelCaso(), correoColaborador }), receptor);
    ids.push(id);
    await control.registrarRadicacion(id, { radicado: 'RAD-REC2', evidencia: PDF }, auxiliar);
    await control.registrarRechazo(id, { causal: 'Falta la epicrisis del paciente' });
    expect(await baseDeDatos.guardarPago(id, { valor: '1000.00', fechaPago: '2026-12-01' }, auxiliar.id)).toBeNull();
  });

  it('DA-44 — la función traslada una sola vez y después no admite requerimientos', async () => {
    const id = await registrarCobrada();
    expect(await traslado(id, 'deterioro', 'Primer motivo')).toBe(true);
    expect(await traslado(id, 'deterioro', 'Segundo motivo', '2026-12-05')).toBe(false);
    expect((await fila(id)).motivo_traslado).toBe('Primer motivo');
    expect(await baseDeDatos.guardarRequerimiento(id, 'Un requerimiento tardío.', auxiliar.id)).toBeNull();
  });

  it('DA-44 — deshacerTraslado borra causal, motivo y fecha juntos y solo el del mismo motivo', async () => {
    const id = await registrarCobrada();
    await traslado(id, 'deterioro', 'Motivo a deshacer');
    await baseDeDatos.deshacerTraslado(id, 'Otro motivo');
    expect((await fila(id)).motivo_traslado).toBe('Motivo a deshacer');
    await baseDeDatos.deshacerTraslado(id, 'Motivo a deshacer');
    expect(await fila(id)).toMatchObject({ causal_traslado: null, motivo_traslado: null, fecha_traslado: null });
    expect(await traslado(id, 'deterioro', 'Motivo nuevo', '2026-12-05')).toBe(true);
  });

  it('la función no traslada una pagada ni una dada de baja', async () => {
    const id = await registrarCobrada();
    await servidor.from('incapacidad').update({ decision: 'dar_de_baja', fecha_decision: '2026-12-04' }).eq('id', id);
    expect(await traslado(id, 'deterioro', 'Motivo de prueba')).toBe(false);
    await servidor.from('incapacidad').update({ decision: null, fecha_decision: null }).eq('id', id);
    await control.registrarPago(id, { valor: '1.000', fechaPago: '2026-12-04' }, auxiliar);
    expect(await traslado(id, 'deterioro', 'Motivo de prueba')).toBe(false);
    expect(await fila(id)).toMatchObject({ causal_traslado: null, motivo_traslado: null, fecha_traslado: null });
  });

  it('la tabla exige causal, motivo y fecha juntos, una causal de la lista y un motivo de 3 a 500 caracteres', async () => {
    const id = await registrarCobrada();
    const actualizar = (cambios) => servidor.from('incapacidad').update(cambios).eq('id', id);
    expect((await actualizar({ motivo_traslado: 'Solo el motivo', fecha_traslado: '2026-12-04' })).error?.code).toBe('23514'); // sin causal
    expect((await actualizar({ causal_traslado: 'otra', motivo_traslado: 'Motivo válido', fecha_traslado: '2026-12-04' })).error?.code).toBe('23514');
    expect((await actualizar({ causal_traslado: 'deterioro', motivo_traslado: 'ab', fecha_traslado: '2026-12-04' })).error?.code).toBe('23514');
    await expect(traslado(id, 'deterioro', 'x'.repeat(501))).rejects.toMatchObject({ code: '23514' });
  });

  it('una pagada sin tiempo de pago solo es la rechazada recuperada (la restricción no se salta con NULL)', async () => {
    const id = await registrarCobrada({ requerimientos: 0 });
    const directo = await servidor.from('incapacidad').update({ estado: 'pagada', tiempo_pago: null, fecha_cobrada: null }).eq('id', id);
    expect(directo.error?.code).toBe('23514');
  });

  it('HU-19.CA2 — después del traslado el pago se registra con registrarPago y queda pagada', async () => {
    const id = await registrarCobrada();
    await control.trasladarACartera(id, { causal: 'deterioro', motivo: 'La entidad está en liquidación' });
    expect((await control.prepararRequerimientos(id)).puedeRegistrarPago).toBe(true);
    hoy = '2026-12-10';
    await control.registrarPago(id, { valor: '1.250.000', fechaPago: '2026-12-10' }, auxiliar);
    expect(await fila(id)).toMatchObject({ estado: 'pagada', causal_traslado: 'deterioro' });
  });
});
