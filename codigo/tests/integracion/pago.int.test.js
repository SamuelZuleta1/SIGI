// HU-15 contra Supabase (nube): registrar_pago (migración 20261121183808) guarda el pago y pone «pagada» en una
// transacción, solo desde cobrada o pagada (DA-08, DA-40); varios pagos (HU-15.CA3).
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
const control = crearControlIncapacidades({ baseDeDatos, correo: crearCorreoFalso().correo, hoy: () => '2026-11-21' });

const correoColaborador = `prueba.pago.${Date.now()}@sigi.test`;
const ids = [];
let receptor;
let auxiliar;

const registrarYRadicar = async () => {
  const { idIncapacidad } = await control.registrarIncapacidad(formularioDeRegistro({ diasIncapacidad: diasDelCaso(), correoColaborador }), receptor);
  ids.push(idIncapacidad);
  await control.registrarRadicacion(idIncapacidad, { radicado: 'RAD-PAGO', evidencia: PDF }, auxiliar);
  return idIncapacidad;
};
const registrarCobrada = async () => {
  const id = await registrarYRadicar();
  await control.registrarCobrada(id, { tiempoPago: '30' });
  return id;
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

describe('HU-15 — registrar el pago (base de datos)', () => {
  it('HU-15.CA1 — cobrada → pagada; guarda valor exacto, fecha y quien lo registra', async () => {
    const id = await registrarCobrada();
    const { idPago } = await control.registrarPago(id, { valor: '1.234.567,89', fechaPago: '2026-11-20' }, auxiliar);

    const { data } = await servidor.from('pago').select('incapacidad_id, valor, fecha_pago, conciliado, creado_por').eq('id', idPago).single();
    expect(data).toMatchObject({ incapacidad_id: id, fecha_pago: '2026-11-20', conciliado: false, creado_por: auxiliar.id });
    expect(Number(data.valor).toFixed(2)).toBe('1234567.89');
    const datos = await baseDeDatos.obtenerDatosCobro(id);
    expect(datos.estado).toBe('pagada');
    expect(datos.pagos).toEqual([{ idPago, valor: '1234567.89', fechaPago: '2026-11-20', conciliado: false, anulacion: null }]);
  });

  it('HU-15.CA3 — varios pagos, en orden, y el total exacto', async () => {
    const id = await registrarCobrada();
    await control.registrarPago(id, { valor: '800.000', fechaPago: '2026-11-10' }, auxiliar);
    await control.registrarPago(id, { valor: '450.000,10', fechaPago: '2026-11-21' }, auxiliar);
    const cobro = await control.prepararCobro(id);
    expect(cobro.incapacidad.pagos.map((p) => p.valor)).toEqual(['800000.00', '450000.10']);
    expect(cobro.totalPagado).toBe('1250000.10');
    expect(cobro.incapacidad.estado).toBe('pagada');
  });

  it('EST-01 — la transacción no guarda pagos de una transcrita ni de una inexistente', async () => {
    const id = await registrarYRadicar();
    expect(await baseDeDatos.guardarPago(id, { valor: '1000.00', fechaPago: '2026-11-20' }, auxiliar.id)).toBeNull();
    expect(await baseDeDatos.guardarPago(2_000_000_000, { valor: '1000.00', fechaPago: '2026-11-20' }, auxiliar.id)).toBeNull();
    const { count } = await servidor.from('pago').select('id', { count: 'exact', head: true }).eq('incapacidad_id', id);
    expect(count).toBe(0);
    expect((await baseDeDatos.obtenerDatosCobro(id)).estado).toBe('transcrita');
  });

  it('DA-40 — un valor no positivo revierte toda la transacción (el estado no cambia)', async () => {
    const id = await registrarCobrada();
    await expect(baseDeDatos.guardarPago(id, { valor: '0', fechaPago: '2026-11-20' }, auxiliar.id)).rejects.toMatchObject({ code: '23514' });
    expect((await baseDeDatos.obtenerDatosCobro(id)).estado).toBe('cobrada');
  });

  it('DA-40 — una pagada siempre conserva su tiempo de pago', async () => {
    const id = await registrarYRadicar();
    const directo = await servidor.from('incapacidad').update({ estado: 'pagada' }).eq('id', id);
    expect(directo.error?.code).toBe('23514');
  });
});
