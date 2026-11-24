// HU-26 contra Supabase (nube): registrar_conciliacion guarda la conciliación, enlaza los pagos y marca
// `pago.conciliado` en una transacción; rechaza lo que cambió; deshacer_conciliacion lo libera todo (DA-11, DA-56).
// Requisitos: proyecto vinculado, migraciones aplicadas y `npm run db:usuarios`.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { crearClienteServidor } from '../../src/config/supabase.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { ErrorDeAviso } from '../../src/controllers/error-de-aviso.js';
import { crearBaseDeDatos } from '../../src/persistence/base-de-datos.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';

const servidor = crearClienteServidor();
const baseDeDatos = crearBaseDeDatos(servidor);
const { correo, enviados } = crearCorreoFalso();
const control = crearControlIncapacidades({ baseDeDatos, correo });

// Nombres únicos para encontrar (y borrar) solo lo que crea esta prueba.
const marca = `Prueba HU-26 ${Date.now()}`;
let auxiliar;
let entidad;
const incapacidades = [];
const conciliaciones = [];

const comprobar = ({ data, error }) => {
  if (error) throw error;
  return data;
};

/** Una incapacidad pagada de la entidad, con su pago (HU-15). Devuelve el id del pago. */
async function pagoRegistrado(nombre, valor) {
  const colaborador = comprobar(
    await servidor.from('colaborador').insert({ nombre, correo: `${Date.now()}.${incapacidades.length}@hu26.sigi.test`, creado_por: auxiliar.id }).select('id').single(),
  );
  const incapacidad = comprobar(
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
  incapacidades.push({ id: incapacidad.id, colaborador: colaborador.id });
  return comprobar(await servidor.rpc('registrar_pago', { p_incapacidad_id: incapacidad.id, p_valor: valor, p_fecha_pago: '2026-11-10', p_creado_por: auxiliar.id }));
}

const consignar = (filas) =>
  baseDeDatos.guardarPagosConsignados(entidad.id, filas.map(([colaborador, valor]) => ({ colaborador, diasPagados: 5, valor })), auxiliar.id);

beforeAll(async () => {
  const { data, error } = await servidor.from('usuario').select('id, correo, rol').eq('correo', 'auxiliar1@sigi.test').maybeSingle();
  if (error || !data) throw new Error('Faltan los usuarios de demostración: ejecute `npm run db:usuarios`');
  auxiliar = data;
  // Una entidad sin consignados pendientes de otras pruebas: la última del catálogo.
  entidad = (await baseDeDatos.consultarEntidades()).at(-1);
  const pendientes = await baseDeDatos.obtenerPagosConsignados(entidad.id);
  if (pendientes.length > 0) throw new Error(`${entidad.nombre} tiene pagos consignados por identificar de otra prueba`);
});

afterAll(async () => {
  for (const id of conciliaciones) await servidor.rpc('deshacer_conciliacion', { p_id: id });
  await servidor.from('pago_consignado').delete().like('colaborador', `${marca}%`);
  for (const { id, colaborador } of incapacidades) {
    await servidor.from('incapacidad').delete().eq('id', id);
    await servidor.from('colaborador').delete().eq('id', colaborador);
  }
});

describe('HU-26 — conciliación (persistencia real)', () => {
  it('HU-26.CA2 — guarda la conciliación, marca los pagos conciliados y los saca de los pendientes', async () => {
    await consignar([[`${marca} Ana`, '1250000.00']]);
    const pago = await pagoRegistrado(`${marca} Ana`, '1250000.00');
    const vista = await control.prepararConciliacion(String(entidad.id));
    expect(vista.pagos.map((p) => p.idPago)).toContain(pago);
    expect(vista.coincidencias.pagos).toContain(pago);

    const { idConciliacion, conciliada } = await control.identificarPagos({ entidad: String(entidad.id), pagos: String(pago) }, auxiliar);
    conciliaciones.push(idConciliacion);
    expect(conciliada).toBe(true);
    expect(comprobar(await servidor.from('pago').select('conciliado, conciliacion_id').eq('id', pago).single())).toEqual({ conciliado: true, conciliacion_id: idConciliacion });
    const guardada = await control.consultarConciliacion(idConciliacion);
    expect(guardada).toMatchObject({ entidadId: entidad.id, saldosPendientes: [] });
    expect(guardada.detalle).toMatchObject([{ colaborador: `${marca} Ana`, idPago: pago, valor: '1250000.00' }]);
    expect(await baseDeDatos.obtenerPagosConsignados(entidad.id)).toEqual([]);
    expect((await baseDeDatos.consultarPagosPorConciliar(entidad.id)).map((p) => p.idPago)).not.toContain(pago);
    expect(enviados.at(-1).subject).toBe(`[SIGI] Detalle conciliado — ${entidad.nombre}`);
  });

  it('HU-26.CA3 — guarda los saldos; el consignado sin identificar sigue pendiente', async () => {
    await consignar([[`${marca} Luis`, '420000.50']]);
    const { idConciliacion, conciliada } = await control.identificarPagos({ entidad: String(entidad.id) }, auxiliar);
    conciliaciones.push(idConciliacion);
    expect(conciliada).toBe(false);
    expect((await control.consultarConciliacion(idConciliacion)).saldosPendientes).toMatchObject([
      { tipo: 'consignado', colaborador: `${marca} Luis`, valor: '420000.50' },
    ]);
    expect((await baseDeDatos.obtenerPagosConsignados(entidad.id)).map((c) => c.colaborador)).toEqual([`${marca} Luis`]);
  });

  it('registrar_conciliacion no guarda nada si los pendientes cambiaron o el pago ya se concilió', async () => {
    const [pendiente] = await baseDeDatos.obtenerPagosConsignados(entidad.id);
    const pago = await pagoRegistrado(`${marca} Luis`, '420000.50');
    // Visto de menos: hay un pendiente que el servidor no comparó.
    expect(await baseDeDatos.guardarConciliacion(entidad.id, { consignadosVistos: [], pares: [], detalle: [], saldos: [] }, auxiliar.id)).toBeNull();
    // Un pago ya conciliado no se puede volver a usar.
    const [{ pago: yaConciliado }] = (await control.consultarConciliacion(conciliaciones[0])).detalle.map((d) => ({ pago: d.idPago }));
    expect(
      await baseDeDatos.guardarConciliacion(
        entidad.id,
        { consignadosVistos: [pendiente.id], pares: [{ consignado: pendiente.id, pago: yaConciliado }], detalle: [], saldos: [] },
        auxiliar.id,
      ),
    ).toBeNull();
    expect(comprobar(await servidor.from('pago').select('conciliado').eq('id', pago).single()).conciliado).toBe(false);
  });

  it('si el correo falla, deshacer_conciliacion libera los pagos y borra la conciliación', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const [{ idPago }] = (await baseDeDatos.consultarPagosPorConciliar(entidad.id)).filter((p) => p.colaborador === `${marca} Luis`);
    const fallido = crearControlIncapacidades({
      baseDeDatos,
      correo: { ...correo, enviarDetalleConciliado: async () => { throw new Error('SMTP caído'); } },
    });
    const antes = (await baseDeDatos.consultarConciliaciones(100)).length;
    const error = await fallido.identificarPagos({ entidad: String(entidad.id), pagos: String(idPago) }, auxiliar).catch((e) => e);
    expect(error).toBeInstanceOf(ErrorDeAviso);
    expect(error.deshecho).toBe(true);
    expect(comprobar(await servidor.from('pago').select('conciliado, conciliacion_id').eq('id', idPago).single())).toEqual({ conciliado: false, conciliacion_id: null });
    expect(await baseDeDatos.obtenerPagosConsignados(entidad.id)).toHaveLength(1);
    expect((await baseDeDatos.consultarConciliaciones(100)).length).toBe(antes);
  });

  it('la base de datos exige que conciliado coincida con la conciliación', async () => {
    const [{ idPago }] = await baseDeDatos.consultarPagosPorConciliar(entidad.id);
    const { error } = await servidor.from('pago').update({ conciliado: true }).eq('id', idPago);
    expect(error).toMatchObject({ code: '23514' });
  });
});
