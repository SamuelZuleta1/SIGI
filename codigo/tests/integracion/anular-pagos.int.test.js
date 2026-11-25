// Auditoría de las HU (pendientes) contra Supabase (nube): anular_pago y anular_pago_consignado (migración
// 20261125192815_anular_pagos) — sin borrar, con quién, cuándo y el motivo; solo sin conciliar ni archivo preparado; un
// anulado no cuenta para la conciliación (registrar_conciliacion) ni para el archivo (preparar_archivo).
// Requisitos: proyecto vinculado, migraciones aplicadas y `npm run db:usuarios`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearClientePublico, crearClienteServidor } from '../../src/config/supabase.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearBaseDeDatos } from '../../src/persistence/base-de-datos.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';

const servidor = crearClienteServidor();
const baseDeDatos = crearBaseDeDatos(servidor);
const control = crearControlIncapacidades({ baseDeDatos, correo: crearCorreoFalso().correo });

const marca = `Prueba anular ${Date.now()}`;
const MOTIVO = 'Se digitó 1.250.000 y eran 125.000';
let auxiliar;
let contabilidad;
let entidad;
const incapacidades = [];
const conciliaciones = [];

const comprobar = ({ data, error }) => {
  if (error) throw error;
  return data;
};

/** Una incapacidad cobrada de la entidad con un pago (HU-15). Devuelve { id, pago }. */
async function pagada(nombre, valor) {
  const colaborador = comprobar(
    await servidor.from('colaborador').insert({ nombre, correo: `${Date.now()}.${incapacidades.length}@anular.sigi.test`, creado_por: auxiliar.id }).select('id').single(),
  );
  const { id } = comprobar(
    await servidor
      .from('incapacidad')
      .insert({
        colaborador_id: colaborador.id, entidad_id: entidad.id, tipo: 'enfermedad_general', fecha_inicio: '2026-10-01',
        dias_incapacidad: 5, fecha_recepcion: '2026-10-02', estado: 'cobrada', tiempo_pago: 30, fecha_cobrada: '2026-10-05',
        creado_por: auxiliar.id,
      })
      .select('id')
      .single(),
  );
  incapacidades.push({ id, colaborador: colaborador.id });
  const pago = await baseDeDatos.guardarPago(id, { valor, fechaPago: '2026-11-10' }, auxiliar.id);
  return { id, pago };
}
const fila = async (tabla, id) => comprobar(await servidor.from(tabla).select('*').eq('id', id).single());
const estado = async (id) => (await fila('incapacidad', id)).estado;

beforeAll(async () => {
  const usuarios = comprobar(await servidor.from('usuario').select('id, rol').in('correo', ['auxiliar1@sigi.test', 'contabilidad1@sigi.test']));
  auxiliar = usuarios.find((u) => u.rol === 'auxiliar');
  contabilidad = usuarios.find((u) => u.rol === 'contabilidad');
  if (!auxiliar || !contabilidad) throw new Error('Faltan los usuarios de demostración: ejecute `npm run db:usuarios`');
  entidad = (await baseDeDatos.consultarEntidades()).at(-1);
  if ((await baseDeDatos.obtenerPagosConsignados(entidad.id)).length > 0) {
    throw new Error(`${entidad.nombre} tiene pagos consignados por identificar de otra prueba`);
  }
});

afterAll(async () => {
  for (const id of conciliaciones) await servidor.rpc('deshacer_conciliacion', { p_id: id });
  await servidor.from('pago_consignado').delete().like('colaborador', `${marca}%`);
  for (const { id, colaborador } of incapacidades) {
    await servidor.from('incapacidad').delete().eq('id', id);
    await servidor.from('colaborador').delete().eq('id', colaborador);
  }
});

describe('HU-15 (auditoría) — anular_pago (base de datos)', () => {
  it('guarda quién, cuándo y el motivo, no borra, y con el último vigente la incapacidad vuelve a «cobrada»', async () => {
    const { id, pago } = await pagada(`${marca} Ana`, '800000.00');
    const otro = await baseDeDatos.guardarPago(id, { valor: '450000.00', fechaPago: '2026-11-12' }, auxiliar.id);

    expect(await baseDeDatos.anularPago(pago, MOTIVO, auxiliar.id)).toBe(true);
    expect(await fila('pago', pago)).toMatchObject({ anulado_por: auxiliar.id, motivo_anulacion: MOTIVO, anulado_en: expect.any(String) });
    expect(await estado(id)).toBe('pagada'); // queda otro vigente

    expect(await baseDeDatos.anularPago(otro, MOTIVO, auxiliar.id)).toBe(true);
    expect(await estado(id)).toBe('cobrada');
    expect((await fila('incapacidad', id)).tiempo_pago).toBe(30); // conserva el cobro
    const { pagos } = await baseDeDatos.obtenerDatosCobro(id);
    expect(pagos.map((p) => p.anulacion?.por)).toEqual(['auxiliar1@sigi.test', 'auxiliar1@sigi.test']);

    expect(await baseDeDatos.anularPago(pago, MOTIVO, auxiliar.id)).toBe(false); // ya anulado
  });

  it('no anula un pago conciliado ni uno con el archivo preparado', async () => {
    const conciliado = await pagada(`${marca} Beto`, '100000.00');
    await baseDeDatos.guardarPagosConsignados(entidad.id, [{ colaborador: `${marca} Beto`, diasPagados: 5, valor: '100000.00' }], contabilidad.id);
    const { idConciliacion } = await control.identificarPagos({ entidad: String(entidad.id), pagos: String(conciliado.pago) }, auxiliar);
    conciliaciones.push(idConciliacion);
    expect(await baseDeDatos.anularPago(conciliado.pago, MOTIVO, auxiliar.id)).toBe(false);
    expect((await fila('pago', conciliado.pago)).anulado_en).toBeNull();

    expect(await servidor.rpc('preparar_archivo', { p_incapacidad_id: conciliado.id, p_por: auxiliar.id })).toMatchObject({ data: true });
    const otro = await baseDeDatos.guardarPago(conciliado.id, { valor: '1.00', fechaPago: '2026-11-12' }, auxiliar.id);
    expect(otro).toBeNull(); // con el archivo preparado ni se registran pagos
  });

  it('HU-29 — un pago anulado no bloquea el archivo; sin ninguno vigente no hay archivo', async () => {
    const { id, pago } = await pagada(`${marca} Caro`, '125000.00');
    const malo = await baseDeDatos.guardarPago(id, { valor: '1250000.00', fechaPago: '2026-11-11' }, auxiliar.id);
    expect(await baseDeDatos.anularPago(malo, MOTIVO, auxiliar.id)).toBe(true);
    await baseDeDatos.guardarPagosConsignados(entidad.id, [{ colaborador: `${marca} Caro`, diasPagados: 5, valor: '125000.00' }], contabilidad.id);
    const { idConciliacion, conciliada } = await control.identificarPagos({ entidad: String(entidad.id), pagos: String(pago) }, auxiliar);
    conciliaciones.push(idConciliacion);
    expect(conciliada).toBe(true);
    expect(await servidor.rpc('preparar_archivo', { p_incapacidad_id: id, p_por: auxiliar.id })).toMatchObject({ data: true });

    const solo = await pagada(`${marca} Dani`, '5000.00');
    await baseDeDatos.anularPago(solo.pago, MOTIVO, auxiliar.id);
    expect(await servidor.rpc('preparar_archivo', { p_incapacidad_id: solo.id, p_por: auxiliar.id })).toMatchObject({ data: false });
  });

  it('las restricciones de la tabla: los tres datos juntos, motivo de 10 a 500 sin caracteres de control, y nunca conciliado', async () => {
    const { pago } = await pagada(`${marca} Eva`, '7000.00');
    const actualizar = (cambios) => servidor.from('pago').update(cambios).eq('id', pago);
    expect((await actualizar({ anulado_en: new Date().toISOString() })).error?.message).toMatch(/pago_anulacion_auditada/);
    const completo = { anulado_en: new Date().toISOString(), anulado_por: auxiliar.id };
    expect((await actualizar({ ...completo, motivo_anulacion: 'corto' })).error?.message).toMatch(/pago_motivo_anulacion_largo/);
    expect((await actualizar({ ...completo, motivo_anulacion: `Motivo con \u0001 control` })).error?.message).toMatch(/pago_motivo_anulacion_largo/);
    const { data: c } = await servidor.from('conciliacion').select('id').limit(1).maybeSingle();
    if (c) {
      expect((await actualizar({ ...completo, motivo_anulacion: MOTIVO, conciliado: true, conciliacion_id: c.id })).error?.message).toMatch(
        /pago_anulado_sin_conciliar/,
      );
    }
  });
});

describe('HU-25 (auditoría) — anular_pago_consignado (base de datos)', () => {
  it('anulado: no queda por identificar, no cuenta en la conciliación y no deja saldos', async () => {
    const { pago } = await pagada(`${marca} Fer`, '125000.00');
    const [bueno, malo] = await baseDeDatos.guardarPagosConsignados(
      entidad.id,
      [
        { colaborador: `${marca} Fer`, diasPagados: 5, valor: '125000.00' },
        { colaborador: `${marca} Fer`, diasPagados: 5, valor: '1250000.00' },
      ],
      contabilidad.id,
    );
    expect(await baseDeDatos.anularPagoConsignado(malo, MOTIVO, contabilidad.id)).toBe(true);
    expect(await fila('pago_consignado', malo)).toMatchObject({ anulado_por: contabilidad.id, motivo_anulacion: MOTIVO });
    expect((await baseDeDatos.obtenerPagosConsignados(entidad.id)).map((p) => p.id)).toEqual([bueno]);
    expect((await baseDeDatos.contarPorIdentificar())[entidad.id]).toBe(1);

    const { idConciliacion, conciliada } = await control.identificarPagos({ entidad: String(entidad.id), pagos: String(pago) }, auxiliar);
    conciliaciones.push(idConciliacion);
    expect(conciliada).toBe(true);
    expect((await fila('conciliacion', idConciliacion)).saldos_pendientes).toEqual([]);
    expect((await fila('pago_consignado', malo)).conciliacion_id).toBeNull();

    expect(await baseDeDatos.anularPagoConsignado(bueno, MOTIVO, contabilidad.id)).toBe(false); // ya identificado
    expect(await baseDeDatos.anularPagoConsignado(malo, MOTIVO, contabilidad.id)).toBe(false); // ya anulado
  });

  it('registrar_conciliacion rechaza una lista vista que incluya un consignado anulado', async () => {
    const [id] = await baseDeDatos.guardarPagosConsignados(entidad.id, [{ colaborador: `${marca} Gil`, diasPagados: 5, valor: '9000.00' }], contabilidad.id);
    await baseDeDatos.anularPagoConsignado(id, MOTIVO, contabilidad.id);
    const { data } = await servidor.rpc('registrar_conciliacion', {
      p_entidad_id: entidad.id, p_consignados_vistos: [id], p_pares: [], p_detalle: [], p_saldos: [], p_creado_por: auxiliar.id,
    });
    expect(data).toBeNull();
  });
});

describe('Permisos de las funciones nuevas', () => {
  it('ni anon ni un navegador pueden ejecutarlas: solo el servidor (service_role)', async () => {
    const publico = crearClientePublico();
    const a = await publico.rpc('anular_pago', { p_pago_id: 1, p_motivo: MOTIVO, p_por: auxiliar.id });
    const b = await publico.rpc('anular_pago_consignado', { p_id: 1, p_motivo: MOTIVO, p_por: auxiliar.id });
    expect(a.error?.code).toBe('42501');
    expect(b.error?.code).toBe('42501');
  });
});
