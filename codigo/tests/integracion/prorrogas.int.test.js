// DA-50 contra Supabase (nube): prórrogas. El trigger mantiene los datos del caso (días previos y acumulados, fechas
// reales de los días 90/120/150/180/181, el anterior deja de ser vigente y el monitoreo pasa a la prórroga);
// registrar_prorroga toma colaborador, entidad y tipo de la anterior y rechaza lo que no es una prórroga; el monitoreo
// y las escrituras condicionadas trabajan sobre el certificado vigente.
// Requisitos: proyecto vinculado, migraciones aplicadas y `npm run db:usuarios`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearClienteServidor } from '../../src/config/supabase.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearBaseDeDatos } from '../../src/persistence/base-de-datos.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';

const servidor = crearClienteServidor();
const baseDeDatos = crearBaseDeDatos(servidor);
const { correo } = crearCorreoFalso();
const HOY = '2026-11-23';
const control = crearControlIncapacidades({ baseDeDatos, correo, hoy: () => HOY });

const marca = `Prueba DA-50 ${Date.now()}`;
let auxiliar;
let entidad;
let colaborador;
const creadas = []; // en orden de creación: se borran al revés (las prórrogas antes que su anterior)

const comprobar = ({ data, error }) => {
  if (error) throw error;
  return data;
};
const fila = async (id) => comprobar(await servidor.from('incapacidad').select('*').eq('id', id).single());

async function primera(dias, fechaInicio = '2026-04-01', tipo = 'enfermedad_general') {
  const { id } = comprobar(
    await servidor
      .from('incapacidad')
      .insert({ colaborador_id: colaborador, entidad_id: entidad.id, tipo, fecha_inicio: fechaInicio, dias_incapacidad: dias, fecha_recepcion: fechaInicio, creado_por: auxiliar.id })
      .select('id')
      .single(),
  );
  creadas.push(id);
  return id;
}

async function prorroga(anterior, dias, fechaInicio) {
  const { data, error } = await servidor.rpc('registrar_prorroga', {
    p_anterior: anterior, p_fecha_inicio: fechaInicio, p_dias: dias, p_fecha_recepcion: fechaInicio, p_creado_por: auxiliar.id,
  });
  if (!error) creadas.push(Number(data));
  return { id: error ? null : Number(data), codigo: error?.code ?? null };
}

beforeAll(async () => {
  const { data, error } = await servidor.from('usuario').select('id').eq('correo', 'auxiliar1@sigi.test').maybeSingle();
  if (error || !data) throw new Error('Faltan los usuarios de demostración: ejecute `npm run db:usuarios`');
  auxiliar = data;
  entidad = comprobar(await servidor.from('entidad').select('id, nombre').eq('nombre', 'Nueva EPS').single());
  colaborador = comprobar(
    await servidor.from('colaborador').insert({ nombre: marca, correo: `da50.${Date.now()}@sigi.test`, creado_por: auxiliar.id }).select('id').single(),
  ).id;
});

afterAll(async () => {
  for (const id of [...creadas].reverse()) await servidor.from('incapacidad').delete().eq('id', id);
  await servidor.from('colaborador').delete().eq('id', colaborador);
});

describe('DA-50 — prórrogas (persistencia real)', () => {
  it('una incapacidad sin prórroga es la primera de su caso, con las fechas de sus hitos', async () => {
    const id = await primera(130);
    expect(await fila(id)).toMatchObject({
      prorroga_de: null, caso_id: id, dias_previos: 0, dias_acumulados: 130, tiene_prorroga: false,
      fecha_dia_90: '2026-06-29', fecha_dia_120: '2026-07-29', fecha_dia_150: null,
    });
  });

  it('la cadena 60 + 40 + (10 días de interrupción) 60 acumula los días con las fechas reales', async () => {
    const uno = await primera(60);
    const { id: dos } = await prorroga(uno, 40, '2026-05-31');
    const { id: tres } = await prorroga(dos, 60, '2026-07-20');
    expect(await fila(uno)).toMatchObject({ tiene_prorroga: true, dias_acumulados: 60 });
    expect(await fila(dos)).toMatchObject({ prorroga_de: uno, caso_id: uno, dias_previos: 60, dias_acumulados: 100, tiene_prorroga: true, fecha_dia_90: '2026-06-29' });
    const ultima = await fila(tres);
    expect(ultima).toMatchObject({
      prorroga_de: dos, caso_id: uno, dias_previos: 100, dias_acumulados: 160, tiene_prorroga: false,
      colaborador_id: colaborador, entidad_id: entidad.id, tipo: 'enfermedad_general', estado: null,
      fecha_dia_90: '2026-06-29', fecha_dia_120: '2026-08-08', fecha_dia_150: '2026-09-07', fecha_dia_180: null,
    });

    // El monitoreo lista el caso una vez, en la vigente, y no deja registrar en una anterior.
    const { prolongadas } = await control.consultarReporteProlongadas('accion');
    const delCaso = prolongadas.filter((p) => p.colaborador === marca && [uno, dos, tres].includes(p.idIncapacidad));
    expect(delCaso.map((p) => [p.idIncapacidad, p.diasCaso])).toEqual([[tres, 160]]);
    expect(await baseDeDatos.guardarFaltaConcepto(dos, { n: 120, hoy: HOY }, auxiliar.id)).toBe(false);
    expect(await baseDeDatos.guardarFaltaConcepto(tres, { n: 120, hoy: '2026-08-07' }, auxiliar.id)).toBe(false); // aún no
    expect(await baseDeDatos.guardarFaltaConcepto(tres, { n: 120, hoy: HOY }, auxiliar.id)).toBe(true);
  });

  it('el estado del monitoreo pasa a la prórroga', async () => {
    const id = await primera(130);
    expect(await baseDeDatos.guardarFaltaConcepto(id, { n: 120, hoy: HOY }, auxiliar.id)).toBe(true);
    const { id: siguiente } = await prorroga(id, 30, '2026-08-09');
    expect(await fila(siguiente)).toMatchObject({ falta_concepto: true, falta_concepto_por: auxiliar.id, dias_acumulados: 160 });
  });

  it.each([
    ['ya tiene prórroga', 'SG011', async () => { const a = await primera(10); await prorroga(a, 5, '2026-04-11'); return [a, '2026-04-11']; }],
    ['es una licencia', 'SG012', async () => [await primera(126, '2026-04-01', 'licencia_maternidad'), '2026-08-05']],
    ['empieza antes del fin de la anterior', 'SG013', async () => [await primera(10), '2026-04-10']],
    ['empieza con más de 30 días de interrupción', 'SG013', async () => [await primera(10), '2026-05-12']],
    ['la anterior no existe', 'SG010', async () => [0, '2026-04-11']],
  ])('registrar_prorroga rechaza cuando %s (%s)', async (_, codigo, preparar) => {
    const [anterior, fechaInicio] = await preparar();
    expect(await prorroga(anterior, 5, fechaInicio)).toEqual({ id: null, codigo });
  });

  it('SG014: un certificado con prórroga no cambia su fecha ni sus días, y una prórroga no cambia de anterior', async () => {
    const uno = await primera(10);
    const { id: dos } = await prorroga(uno, 5, '2026-04-11');
    const otro = await primera(10, '2026-06-01');
    for (const cambio of [{ dias_incapacidad: 12 }, { fecha_inicio: '2026-03-31' }]) {
      const { error } = await servidor.from('incapacidad').update(cambio).eq('id', uno);
      expect(error?.code).toBe('SG014');
    }
    expect((await servidor.from('incapacidad').update({ prorroga_de: otro }).eq('id', dos)).error?.code).toBe('SG014');
    // La vigente (sin prórroga) sí se puede corregir, y sus derivados se recalculan.
    comprobar(await servidor.from('incapacidad').update({ dias_incapacidad: 8 }).eq('id', dos));
    expect(await fila(dos)).toMatchObject({ dias_previos: 10, dias_acumulados: 18 });
  });

  it('el deshacer de un aviso fallido también revierte la prórroga que copió el estado', async () => {
    const id = await primera(130);
    expect(await baseDeDatos.guardarFaltaConcepto(id, { n: 120, hoy: HOY }, auxiliar.id)).toBe(true);
    const { id: siguiente } = await prorroga(id, 30, '2026-08-09');
    expect((await fila(siguiente)).falta_concepto).toBe(true);
    await baseDeDatos.deshacerFaltaConcepto(id);
    expect((await fila(id)).falta_concepto).toBe(false);
    expect(await fila(siguiente)).toMatchObject({ falta_concepto: false, fecha_falta_concepto: null, falta_concepto_por: null });
  });

  it('admite exactamente 30 días de interrupción, y el control la registra con la persistencia real', async () => {
    const anterior = await primera(10); // fin 10 abr
    const { idIncapacidad } = await control.registrarProrroga(String(anterior), { fechaInicio: '2026-05-11', diasIncapacidad: '5', fechaRecepcion: '2026-05-11' }, auxiliar);
    creadas.push(idIncapacidad);
    expect(await fila(idIncapacidad)).toMatchObject({ prorroga_de: anterior, dias_previos: 10, creado_por: auxiliar.id });
    expect((await control.prepararProrroga(String(anterior))).anterior.prorroga).toBe(idIncapacidad);
  });

  it('el reconocimiento de una prórroga usa sus días del caso', async () => {
    const uno = await primera(60);
    const { id: dos } = await prorroga(uno, 40, '2026-05-31');
    const r = await control.calcularReconocimiento(String(dos), { ibc: '3.000.000' }, auxiliar);
    expect(r).toMatchObject({ valorEmpresa: 0, valorEPS: 251_000_000 });
    expect(await fila(dos)).toMatchObject({ valor_empresa: 0, valor_eps: 2510000 });
  });
});
