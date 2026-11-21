// HU-14 contra Supabase (nube): guardarRechazo (UPDATE condicionado a transcrita) y las restricciones de la
// migraciones 20261121182147 (una rechazada siempre con causal; causal de 3 a 500 caracteres) y
// 20261121182931 (fecha_rechazo, junto con la causal) — DA-39.
// Requisitos: proyecto vinculado, migraciones aplicadas y `npm run db:usuarios`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUCKET_DOCUMENTOS, crearClienteServidor } from '../../src/config/supabase.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearBaseDeDatos } from '../../src/persistence/base-de-datos.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { formularioDeRegistro, PDF } from '../helpers/fabricas.js';

const servidor = crearClienteServidor();
const baseDeDatos = crearBaseDeDatos(servidor);
const control = crearControlIncapacidades({ baseDeDatos, correo: crearCorreoFalso().correo, hoy: () => '2026-11-21' });

const correoColaborador = `prueba.rechazo.${Date.now()}@sigi.test`;
const ids = [];
let receptor;
let auxiliar;

const radicar = (id, radicado) => control.registrarRadicacion(id, { radicado, evidencia: PDF }, auxiliar);
const registrarYRadicar = async () => {
  const { idIncapacidad } = await control.registrarIncapacidad(formularioDeRegistro({ correoColaborador }), receptor);
  ids.push(idIncapacidad);
  await radicar(idIncapacidad, 'RAD-RECHAZO-1');
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
    const { data } = await servidor.from('radicacion').select('evidencia').in('incapacidad_id', ids);
    const rutas = (data ?? []).map((r) => r.evidencia).filter(Boolean);
    if (rutas.length) await servidor.storage.from(BUCKET_DOCUMENTOS).remove(rutas);
    await servidor.from('incapacidad').delete().in('id', ids);
  }
  await servidor.from('colaborador').delete().eq('correo', correoColaborador);
});

describe('HU-14 — registrar el rechazo (base de datos)', () => {
  it('HU-14.CA1 / CA2 — transcrita → rechazada con su causal; una nueva radicación vuelve a transcrita', async () => {
    const id = await registrarYRadicar();
    expect(await control.registrarRechazo(id, { causal: 'Falta la epicrisis' })).toEqual({ idIncapacidad: id });
    expect(await baseDeDatos.obtenerDatosCobro(id)).toMatchObject({ estado: 'rechazada', causalRechazo: 'Falta la epicrisis', fechaRechazo: '2026-11-21' });

    await radicar(id, 'RAD-RECHAZO-2');
    const datos = await baseDeDatos.obtenerDatosCobro(id);
    expect(datos).toMatchObject({ estado: 'transcrita', causalRechazo: 'Falta la epicrisis', fechaRechazo: '2026-11-21' });
    expect(datos.radicaciones.map((r) => r.radicado)).toEqual(['RAD-RECHAZO-1', 'RAD-RECHAZO-2']);
  });

  it('EST-01 — el UPDATE condicionado no cambia una incapacidad que no está transcrita', async () => {
    const id = await registrarYRadicar();
    expect(await baseDeDatos.guardarRechazo(id, { causal: 'Primera', fechaRechazo: '2026-11-21' })).toBe(true);
    expect(await baseDeDatos.guardarRechazo(id, { causal: 'Segunda', fechaRechazo: '2026-11-22' })).toBe(false);
    expect(await baseDeDatos.guardarCobrada(id, { tiempoPago: 30, fechaCobrada: '2026-11-21' })).toBe(false);
    expect(await baseDeDatos.obtenerDatosCobro(id)).toMatchObject({ estado: 'rechazada', causalRechazo: 'Primera', fechaRechazo: '2026-11-21', tiempoPago: null });
  });

  it('DA-39 — la base de datos rechaza una rechazada sin causal, causales fuera de 3 a 500 y una causal sin fecha', async () => {
    const id = await registrarYRadicar();
    const sinCausal = await servidor.from('incapacidad').update({ estado: 'rechazada' }).eq('id', id);
    expect(sinCausal.error?.code).toBe('23514');
    await expect(baseDeDatos.guardarRechazo(id, { causal: 'ab', fechaRechazo: '2026-11-21' })).rejects.toMatchObject({ code: '23514' });
    await expect(baseDeDatos.guardarRechazo(id, { causal: 'x'.repeat(501), fechaRechazo: '2026-11-21' })).rejects.toMatchObject({ code: '23514' });
    const sinFecha = await servidor.from('incapacidad').update({ estado: 'rechazada', causal_rechazo: 'Sin fecha' }).eq('id', id);
    expect(sinFecha.error?.code).toBe('23514');
    expect((await baseDeDatos.obtenerDatosCobro(id)).estado).toBe('transcrita');
  });
});
