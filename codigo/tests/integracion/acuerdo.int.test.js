// HU-17 contra Supabase (nube): registrar_acuerdo (migración 20261121185711) guarda la fecha y el valor del acuerdo
// solo con la incapacidad cobrada y sin dar de baja (DA-42), y el retraso se avisa a la Coordinación (correo falso).
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

const correoColaborador = `prueba.acuerdo.${Date.now()}@sigi.test`;
const ids = [];
let receptor;
let auxiliar;

const registrarCobrada = async () => {
  hoy = '2026-11-21';
  const { idIncapacidad } = await control.registrarIncapacidad(formularioDeRegistro({ correoColaborador }), receptor);
  ids.push(idIncapacidad);
  await control.registrarRadicacion(idIncapacidad, { radicado: 'RAD-ACU', evidencia: PDF }, auxiliar);
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
    const seguimientos = await servidor.from('seguimiento').select('evidencia').in('incapacidad_id', ids);
    const rutas = [...(radicaciones.data ?? []), ...(seguimientos.data ?? [])].map((r) => r.evidencia).filter(Boolean);
    if (rutas.length) await servidor.storage.from(BUCKET_DOCUMENTOS).remove(rutas);
    await servidor.from('incapacidad').delete().in('id', ids);
  }
  await servidor.from('colaborador').delete().eq('correo', correoColaborador);
});

describe('HU-17 — retraso y acuerdo de pago (base de datos)', () => {
  it('HU-17.CA1 — el seguimiento con demora se guarda y avisa a la Coordinación', async () => {
    const id = await registrarCobrada();
    const antes = enviados.length;
    const { avisoRetraso } = await control.registrarSeguimiento(id, { evidencia: PDF }, auxiliar);
    expect(avisoRetraso).toBe(true);
    expect(enviados.slice(antes).map((m) => m.to)).toEqual([DESTINATARIOS.coordinacion]);
    expect((await baseDeDatos.obtenerDatosSeguimiento(id)).seguimientos).toHaveLength(1);
  });

  it('HU-17.CA2 — guarda el acuerdo con fecha, valor exacto y quien lo registra', async () => {
    const id = await registrarCobrada();
    const { idAcuerdo } = await control.registrarAcuerdo(id, { fecha: '2026-12-15', valor: '1.234.567,89' }, auxiliar);
    const { data } = await servidor.from('acuerdo_pago').select('incapacidad_id, fecha, valor, creado_por').eq('id', idAcuerdo).single();
    expect(data).toMatchObject({ incapacidad_id: id, fecha: '2026-12-15', creado_por: auxiliar.id });
    expect(Number(data.valor).toFixed(2)).toBe('1234567.89');
    expect((await baseDeDatos.obtenerDatosSeguimiento(id)).acuerdos).toEqual([
      { idAcuerdo, fecha: '2026-12-15', valor: '1234567.89', registrado: expect.any(String) },
    ]);
  });

  it('DA-42 — la función no guarda acuerdos de una pagada ni de una dada de baja', async () => {
    const id = await registrarCobrada();
    await servidor.from('incapacidad').update({ decision: 'dar_de_baja' }).eq('id', id);
    expect(await baseDeDatos.guardarAcuerdo(id, { fecha: '2026-12-15', valor: '1000.00' }, auxiliar.id)).toBeNull();
    await servidor.from('incapacidad').update({ decision: null }).eq('id', id);
    await control.registrarPago(id, { valor: '1.000', fechaPago: '2026-12-04' }, auxiliar);
    expect(await baseDeDatos.guardarAcuerdo(id, { fecha: '2026-12-15', valor: '1000.00' }, auxiliar.id)).toBeNull();
    const { count } = await servidor.from('acuerdo_pago').select('id', { count: 'exact', head: true }).eq('incapacidad_id', id);
    expect(count).toBe(0);
  });
});

describe('HU-17 — último acuerdo en la lista (base de datos)', () => {
  it('consultarCobradas trae solo el acuerdo más reciente', async () => {
    const id = await registrarCobrada();
    await control.registrarAcuerdo(id, { fecha: '2026-12-10', valor: '900.000' }, auxiliar);
    await control.registrarAcuerdo(id, { fecha: '2026-12-15', valor: '1.250.000' }, auxiliar);
    const fila = (await baseDeDatos.consultarCobradas()).find((c) => c.idIncapacidad === id);
    expect(fila.ultimoAcuerdo).toEqual({ fecha: '2026-12-15', valor: '1250000.00' });
  });
});
