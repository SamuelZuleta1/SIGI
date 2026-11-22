// HU-19 contra Supabase (nube): trasladar_a_cartera (migración 20261122054704) guarda el motivo y la fecha solo con
// la incapacidad cobrada, sin dar de baja y sin trasladar antes (DA-44); el pago posterior usa registrarPago.
// Requisitos: proyecto vinculado, migraciones aplicadas y `npm run db:usuarios`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUCKET_DOCUMENTOS, crearClienteServidor } from '../../src/config/supabase.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearBaseDeDatos } from '../../src/persistence/base-de-datos.js';
import { crearCorreoFalso, DESTINATARIOS } from '../helpers/correo-falso.js';
import { formularioDeRegistro, PDF } from '../helpers/fabricas.js';

const servidor = crearClienteServidor();
const baseDeDatos = crearBaseDeDatos(servidor);
const { correo, enviados } = crearCorreoFalso();
let hoy = '2026-11-21';
const control = crearControlIncapacidades({ baseDeDatos, correo, hoy: () => hoy });

const correoColaborador = `prueba.traslado.${Date.now()}@sigi.test`;
const ids = [];
let receptor;
let auxiliar;

const registrarCobrada = async () => {
  hoy = '2026-11-21';
  const { idIncapacidad } = await control.registrarIncapacidad(formularioDeRegistro({ correoColaborador }), receptor);
  ids.push(idIncapacidad);
  await control.registrarRadicacion(idIncapacidad, { radicado: 'RAD-TRA', evidencia: PDF }, auxiliar);
  await control.registrarCobrada(idIncapacidad, { tiempoPago: '10' }); // prometida: 2026-12-01
  hoy = '2026-12-04';
  return idIncapacidad;
};

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
  it('HU-19.CA1 — guarda el motivo y la fecha, y avisa a Cartera (con una advertencia por tener menos de dos)', async () => {
    const id = await registrarCobrada();
    const antes = enviados.length;
    expect(await control.trasladarACartera(id, { motivo: 'Deterioro crediticio de la entidad' })).toMatchObject({ requerimientos: 0, advertencia: true });
    expect(enviados.slice(antes).map((m) => m.to)).toEqual([DESTINATARIOS.cartera]);
    const { data } = await servidor.from('incapacidad').select('estado, motivo_traslado, fecha_traslado').eq('id', id).single();
    expect(data).toEqual({ estado: 'cobrada', motivo_traslado: 'Deterioro crediticio de la entidad', fecha_traslado: '2026-12-04' });
    expect((await baseDeDatos.obtenerDatosRequerimientos(id))).toMatchObject({ motivoTraslado: 'Deterioro crediticio de la entidad', fechaTraslado: '2026-12-04' });
  });

  it('DA-44 — la función traslada una sola vez', async () => {
    const id = await registrarCobrada();
    expect(await baseDeDatos.guardarTraslado(id, 'Primer motivo', '2026-12-04')).toBe(true);
    expect(await baseDeDatos.guardarTraslado(id, 'Segundo motivo', '2026-12-05')).toBe(false);
    const { data } = await servidor.from('incapacidad').select('motivo_traslado').eq('id', id).single();
    expect(data.motivo_traslado).toBe('Primer motivo');
  });

  it('DA-05 — la función no traslada una pagada ni una dada de baja', async () => {
    const id = await registrarCobrada();
    await servidor.from('incapacidad').update({ decision: 'dar_de_baja' }).eq('id', id);
    expect(await baseDeDatos.guardarTraslado(id, 'Motivo de prueba', '2026-12-04')).toBe(false);
    await servidor.from('incapacidad').update({ decision: null }).eq('id', id);
    await control.registrarPago(id, { valor: '1.000', fechaPago: '2026-12-04' }, auxiliar);
    expect(await baseDeDatos.guardarTraslado(id, 'Motivo de prueba', '2026-12-04')).toBe(false);
    const { data } = await servidor.from('incapacidad').select('motivo_traslado, fecha_traslado').eq('id', id).single();
    expect(data).toEqual({ motivo_traslado: null, fecha_traslado: null });
  });

  it('DA-44 — la tabla exige motivo y fecha juntos y un motivo de 3 a 500 caracteres', async () => {
    const id = await registrarCobrada();
    const solo = await servidor.from('incapacidad').update({ motivo_traslado: 'Solo el motivo' }).eq('id', id);
    expect(solo.error?.code).toBe('23514');
    const corto = await servidor.from('incapacidad').update({ motivo_traslado: 'ab', fecha_traslado: '2026-12-04' }).eq('id', id);
    expect(corto.error?.code).toBe('23514');
    await expect(baseDeDatos.guardarTraslado(id, 'x'.repeat(501), '2026-12-04')).rejects.toMatchObject({ code: '23514' });
  });

  it('HU-19.CA2 — después del traslado el pago se registra con registrarPago y queda pagada', async () => {
    const id = await registrarCobrada();
    await control.trasladarACartera(id, { motivo: '180 días sin pago' });
    expect((await control.prepararRequerimientos(id)).puedeRegistrarPago).toBe(true);
    hoy = '2026-12-10';
    await control.registrarPago(id, { valor: '1.250.000', fechaPago: '2026-12-10' }, auxiliar);
    const { data } = await servidor.from('incapacidad').select('estado, motivo_traslado').eq('id', id).single();
    expect(data).toEqual({ estado: 'pagada', motivo_traslado: '180 días sin pago' });
  });
});
