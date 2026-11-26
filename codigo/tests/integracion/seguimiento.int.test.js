// HU-16 contra Supabase (nube): consultarCobradas (sin las dadas de baja, DA-18) y registrar_seguimiento
// (migración 20261121184948: solo cobrada, evidencia obligatoria en el bucket privado; DA-41).
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

const correoColaborador = `prueba.seguimiento.${Date.now()}@sigi.test`;
const ids = [];
let receptor;
let auxiliar;

const registrarCobrada = async () => {
  const { idIncapacidad } = await control.registrarIncapacidad(formularioDeRegistro({ diasIncapacidad: diasDelCaso(), correoColaborador }), receptor);
  ids.push(idIncapacidad);
  await control.registrarRadicacion(idIncapacidad, { radicado: 'RAD-SEG', evidencia: PDF }, auxiliar);
  await control.registrarCobrada(idIncapacidad, { tiempoPago: '30' });
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

describe('HU-16 — seguimiento semanal (base de datos)', () => {
  it('HU-16.CA1 — la cobrada aparece en los pendientes y, dada de baja, sale (DA-18)', async () => {
    const id = await registrarCobrada();
    const ver = async () => (await control.consultarPendientesDePago()).pendientes.find((p) => p.idIncapacidad === id);
    expect(await ver()).toMatchObject({ fechaPrometida: '2026-12-21', ultimoSeguimiento: null, tocaSeguimiento: false });

    await servidor.from('incapacidad').update({ decision: 'dar_de_baja', fecha_decision: '2026-12-04' }).eq('id', id);
    expect(await ver()).toBeUndefined();
    expect(await baseDeDatos.guardarSeguimiento(id, { contenido: PDF, tipoMime: 'application/pdf' }, auxiliar.id)).toBeNull();
  });

  it('HU-16.CA3 — guarda el seguimiento con la evidencia en el bucket privado y el último aparece en la lista', async () => {
    const id = await registrarCobrada();
    const { idSeguimiento, demora } = await control.registrarSeguimiento(id, { evidencia: PDF }, auxiliar);
    expect(demora.conDemora).toBe(false);

    const seguimiento = await baseDeDatos.consultarSeguimiento(idSeguimiento);
    expect(seguimiento.evidencia).toMatch(new RegExp(`^incapacidades/${id}/seguimiento-[0-9a-f-]{36}\\.pdf$`));
    const { url } = await control.verEvidenciaSeguimiento(seguimiento); // DA-71: enlace firmado al bucket
    expect(Buffer.from(await (await fetch(url)).arrayBuffer()).equals(PDF)).toBe(true);

    const pendiente = (await control.consultarPendientesDePago()).pendientes.find((p) => p.idIncapacidad === id);
    expect(pendiente.ultimoSeguimiento).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await control.prepararSeguimiento(id)).incapacidad.seguimientos).toHaveLength(1);
  });

  it('EST-01 — una pagada no admite seguimiento y el archivo subido se borra', async () => {
    const id = await registrarCobrada();
    await control.registrarPago(id, { valor: '1.000', fechaPago: '2026-11-21' }, auxiliar);
    expect(await baseDeDatos.guardarSeguimiento(id, { contenido: PDF, tipoMime: 'application/pdf' }, auxiliar.id)).toBeNull();
    const { data } = await servidor.storage.from(BUCKET_DOCUMENTOS).list(`incapacidades/${id}`);
    expect((data ?? []).filter((o) => o.name.startsWith('seguimiento-'))).toHaveLength(0);
  });

  it('DA-41 — la base de datos exige la evidencia', async () => {
    const id = await registrarCobrada();
    const sin = await servidor.from('seguimiento').insert({ incapacidad_id: id, evidencia: null, creado_por: auxiliar.id });
    expect(sin.error?.code).toBe('23502');
    const fuera = await servidor.from('seguimiento').insert({ incapacidad_id: id, evidencia: '../otro', creado_por: auxiliar.id });
    expect(fuera.error?.code).toBe('23514');
  });
});
