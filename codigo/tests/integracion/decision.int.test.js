// HU-20 contra Supabase (nube): registrar_decision (migración 20261122055601) guarda la decisión y su fecha solo con la
// incapacidad cobrada, trasladada y sin decisión (DA-45), sin cambiar el estado; la baja sale de los pendientes (DA-18).
// Requisitos: proyecto vinculado, migraciones aplicadas y `npm run db:usuarios`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUCKET_DOCUMENTOS, crearClienteServidor } from '../../src/config/supabase.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearBaseDeDatos } from '../../src/persistence/base-de-datos.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { formularioDeRegistro, PDF, diasDistintos } from '../helpers/fabricas.js';

const diasDelCaso = diasDistintos(); // HU-03: sin duplicados entre las pruebas del archivo

const servidor = crearClienteServidor();
const baseDeDatos = crearBaseDeDatos(servidor);
const { correo } = crearCorreoFalso();
let hoy = '2026-11-21';
const control = crearControlIncapacidades({ baseDeDatos, correo, hoy: () => hoy });

const correoColaborador = `prueba.decision.${Date.now()}@sigi.test`;
const ids = [];
let receptor;
let auxiliar;

const registrarTrasladada = async () => {
  hoy = '2026-11-21';
  const { idIncapacidad } = await control.registrarIncapacidad(formularioDeRegistro({ diasIncapacidad: diasDelCaso(), correoColaborador }), receptor);
  ids.push(idIncapacidad);
  await control.registrarRadicacion(idIncapacidad, { radicado: 'RAD-DEC', evidencia: PDF }, auxiliar);
  await control.registrarCobrada(idIncapacidad, { tiempoPago: '10' }); // prometida: 2026-12-01
  hoy = '2026-12-04';
  // Auditoría (4A): el traslado exige 2 requerimientos y una causal.
  for (const n of [1, 2]) await control.registrarRequerimiento(idIncapacidad, { fundamentos: `Requerimiento número ${n} de cobro.` }, auxiliar);
  await control.trasladarACartera(idIncapacidad, { causal: 'deterioro', motivo: '180 días sin pago' });
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

describe('HU-20 — decisión de Cartera y Jurídica (base de datos)', () => {
  it('HU-20.CA1 y CA2 — guarda la decisión y la fecha sin cambiar el estado ni el traslado', async () => {
    const id = await registrarTrasladada();
    hoy = '2026-12-10';
    expect(await control.registrarDecision(id, { decision: 'dar_de_baja' })).toEqual({ idIncapacidad: id, decision: 'dar_de_baja' });
    const { data } = await servidor.from('incapacidad').select('estado, decision, fecha_decision, motivo_traslado').eq('id', id).single();
    expect(data).toEqual({ estado: 'cobrada', decision: 'dar_de_baja', fecha_decision: '2026-12-10', motivo_traslado: '180 días sin pago' });
  });

  it('DA-18 — dada de baja sale de los pendientes; recuperada se queda', async () => {
    const baja = await registrarTrasladada();
    const recupera = await registrarTrasladada();
    await control.registrarDecision(baja, { decision: 'dar_de_baja' });
    await control.registrarDecision(recupera, { decision: 'recuperar' });
    const pendientes = (await baseDeDatos.consultarCobradas()).map((c) => c.idIncapacidad);
    expect(pendientes).toContain(recupera);
    expect(pendientes).not.toContain(baja);
  });

  it('DA-45 — la función decide una sola vez y no sin traslado ni sobre una pagada', async () => {
    const id = await registrarTrasladada();
    expect(await baseDeDatos.guardarDecision(id, 'recuperar', '2026-12-05')).toBe(true);
    expect(await baseDeDatos.guardarDecision(id, 'dar_de_baja', '2026-12-06')).toBe(false);
    const sin = await registrarTrasladada();
    await baseDeDatos.deshacerTraslado(sin, '180 días sin pago');
    expect(await baseDeDatos.guardarDecision(sin, 'recuperar', '2026-12-05')).toBe(false);
    const pagada = await registrarTrasladada();
    await control.registrarPago(pagada, { valor: '1.000', fechaPago: '2026-12-04' }, auxiliar);
    expect(await baseDeDatos.guardarDecision(pagada, 'recuperar', '2026-12-05')).toBe(false);
  });

  it('DA-45 — la tabla exige decisión y fecha juntas', async () => {
    const id = await registrarTrasladada();
    const solo = await servidor.from('incapacidad').update({ decision: 'recuperar' }).eq('id', id);
    expect(solo.error?.code).toBe('23514');
  });
});

describe('HU-20 — lista de trasladadas (base de datos)', () => {
  it('consultarTrasladadas trae la decisión, el motivo y el número de requerimientos', async () => {
    const id = await registrarTrasladada();
    const fila = (await baseDeDatos.consultarTrasladadas()).find((t) => t.idIncapacidad === id);
    expect(fila).toMatchObject({ motivoTraslado: '180 días sin pago', fechaTraslado: '2026-12-04', decision: null, fechaDecision: null, requerimientos: 2, causalTraslado: 'deterioro' });
  });
});
