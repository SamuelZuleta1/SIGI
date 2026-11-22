// HU-18 contra Supabase (nube): registrar_requerimiento (migración 20261122054040) guarda los fundamentos solo con
// la incapacidad cobrada y sin dar de baja (DA-05, DA-43), y la restricción de largo protege la tabla.
// Requisitos: proyecto vinculado, migraciones aplicadas y `npm run db:usuarios`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUCKET_DOCUMENTOS, crearClienteServidor } from '../../src/config/supabase.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearBaseDeDatos } from '../../src/persistence/base-de-datos.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { formularioDeRegistro, PDF } from '../helpers/fabricas.js';

const servidor = crearClienteServidor();
const baseDeDatos = crearBaseDeDatos(servidor);
const { correo } = crearCorreoFalso();
let hoy = '2026-11-21';
const control = crearControlIncapacidades({ baseDeDatos, correo, hoy: () => hoy });

const correoColaborador = `prueba.requerimiento.${Date.now()}@sigi.test`;
const ids = [];
let receptor;
let auxiliar;

const registrarCobrada = async () => {
  hoy = '2026-11-21';
  const { idIncapacidad } = await control.registrarIncapacidad(formularioDeRegistro({ correoColaborador }), receptor);
  ids.push(idIncapacidad);
  await control.registrarRadicacion(idIncapacidad, { radicado: 'RAD-REQ', evidencia: PDF }, auxiliar);
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

describe('HU-18 — requerimientos de cobro persuasivo (base de datos)', () => {
  it('HU-18.CA1 — guarda los fundamentos tal cual y quien los registra', async () => {
    const id = await registrarCobrada();
    const { idRequerimiento, total } = await control.registrarRequerimiento(id, { fundamentos: 'Plazo vencido.\nSe reclama el pago.' }, auxiliar);
    expect(total).toBe(1);
    const { data } = await servidor.from('requerimiento').select('incapacidad_id, fundamentos, creado_por').eq('id', idRequerimiento).single();
    expect(data).toEqual({ incapacidad_id: id, fundamentos: 'Plazo vencido.\nSe reclama el pago.', creado_por: auxiliar.id });
  });

  it('HU-18.CA2 — la pantalla cuenta los requerimientos y cumple el mínimo con dos', async () => {
    const id = await registrarCobrada();
    await control.registrarRequerimiento(id, { fundamentos: 'Primer requerimiento de cobro.' }, auxiliar);
    expect((await control.prepararRequerimientos(id)).cumpleMinimo).toBe(false);
    await control.registrarRequerimiento(id, { fundamentos: 'Segundo requerimiento de cobro.' }, auxiliar);
    const datos = await control.prepararRequerimientos(id);
    expect(datos).toMatchObject({ total: 2, cumpleMinimo: true });
    expect(datos.incapacidad.requerimientos.map((r) => r.fundamentos)).toEqual([
      'Primer requerimiento de cobro.',
      'Segundo requerimiento de cobro.',
    ]);
  });

  it('DA-05 — la función no guarda requerimientos de una pagada ni de una dada de baja', async () => {
    const id = await registrarCobrada();
    await servidor.from('incapacidad').update({ decision: 'dar_de_baja', fecha_decision: '2026-12-04' }).eq('id', id);
    expect(await baseDeDatos.guardarRequerimiento(id, 'Fundamentos de prueba', auxiliar.id)).toBeNull();
    await servidor.from('incapacidad').update({ decision: null, fecha_decision: null }).eq('id', id);
    await control.registrarPago(id, { valor: '1.000', fechaPago: '2026-12-04' }, auxiliar);
    expect(await baseDeDatos.guardarRequerimiento(id, 'Fundamentos de prueba', auxiliar.id)).toBeNull();
    const { count } = await servidor.from('requerimiento').select('id', { count: 'exact', head: true }).eq('incapacidad_id', id);
    expect(count).toBe(0);
  });

  it('DA-43 — la tabla rechaza fundamentos de menos de 10 o más de 2000 caracteres', async () => {
    const id = await registrarCobrada();
    await expect(baseDeDatos.guardarRequerimiento(id, 'corto', auxiliar.id)).rejects.toMatchObject({ code: '23514' });
    await expect(baseDeDatos.guardarRequerimiento(id, 'x'.repeat(2001), auxiliar.id)).rejects.toMatchObject({ code: '23514' });
  });
});

describe('HU-18 — conteo en la lista de pendientes (base de datos)', () => {
  it('consultarCobradas y obtenerDatosSeguimiento traen el número de requerimientos', async () => {
    const id = await registrarCobrada();
    expect((await baseDeDatos.consultarCobradas()).find((c) => c.idIncapacidad === id).requerimientos).toBe(0);
    await control.registrarRequerimiento(id, { fundamentos: 'Primer requerimiento de cobro.' }, auxiliar);
    await control.registrarRequerimiento(id, { fundamentos: 'Segundo requerimiento de cobro.' }, auxiliar);
    expect((await baseDeDatos.consultarCobradas()).find((c) => c.idIncapacidad === id).requerimientos).toBe(2);
    expect((await baseDeDatos.obtenerDatosSeguimiento(id)).requerimientos).toBe(2);
  });
});
