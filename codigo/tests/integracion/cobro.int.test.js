// HU-13 contra Supabase (nube): obtenerDatosCobro y guardarCobrada (UPDATE condicionado a transcrita) con las
// columnas de la migración 20261121180530 (tiempo_pago integer, fecha_cobrada date y sus restricciones; DA-38).
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

const correoColaborador = `prueba.cobro.${Date.now()}@sigi.test`;
const ids = [];
let receptor;
let auxiliar;

const registrarYRadicar = async () => {
  const { idIncapacidad } = await control.registrarIncapacidad(formularioDeRegistro({ correoColaborador }), receptor);
  ids.push(idIncapacidad);
  await control.registrarRadicacion(idIncapacidad, { radicado: 'RAD-COBRO', evidencia: PDF }, auxiliar);
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

describe('HU-13 — registrar cobrada (base de datos)', () => {
  it('HU-13.CA1 — transcrita → cobrada; guarda los días como entero y la fecha', async () => {
    const id = await registrarYRadicar();
    expect(await control.registrarCobrada(id, { tiempoPago: '30' })).toEqual({ idIncapacidad: id });

    const datos = await baseDeDatos.obtenerDatosCobro(id);
    expect(datos).toMatchObject({ idIncapacidad: id, estado: 'cobrada', tiempoPago: 30, fechaCobrada: '2026-11-21' });
    expect(datos.radicaciones).toHaveLength(1);
    expect((await control.prepararCobro(id)).fechaPrometida).toBe('2026-12-21');
  });

  it('EST-01 — el UPDATE condicionado no cambia una incapacidad que no está transcrita', async () => {
    const id = await registrarYRadicar();
    expect(await baseDeDatos.guardarCobrada(id, { tiempoPago: 30, fechaCobrada: '2026-11-21' })).toBe(true);
    expect(await baseDeDatos.guardarCobrada(id, { tiempoPago: 60, fechaCobrada: '2026-11-22' })).toBe(false);
    expect(await baseDeDatos.obtenerDatosCobro(id)).toMatchObject({ tiempoPago: 30, fechaCobrada: '2026-11-21' });
  });

  it('DA-38 — la base de datos rechaza tiempos fuera de 1 a 365 y una cobrada sin tiempo de pago', async () => {
    const id = await registrarYRadicar();
    await expect(baseDeDatos.guardarCobrada(id, { tiempoPago: 0, fechaCobrada: '2026-11-21' })).rejects.toMatchObject({ code: '23514' });
    await expect(baseDeDatos.guardarCobrada(id, { tiempoPago: 400, fechaCobrada: '2026-11-21' })).rejects.toMatchObject({ code: '23514' });
    const sinTiempo = await servidor.from('incapacidad').update({ estado: 'cobrada' }).eq('id', id);
    expect(sinTiempo.error?.code).toBe('23514');
    expect((await baseDeDatos.obtenerDatosCobro(id)).estado).toBe('transcrita');
  });

  it('no existe → null', async () => {
    expect(await baseDeDatos.obtenerDatosCobro(2_000_000_000)).toBeNull();
  });
});
