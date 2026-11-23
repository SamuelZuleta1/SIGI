// HU-21, HU-22 y HU-23 contra Supabase (nube): el cálculo del reconocimiento (guardarCalculo con numeric(14,2)) y las
// escrituras condicionadas del monitoreo de prolongadas (concepto y falta del concepto, con su «deshacer»).
// Requisitos: proyecto vinculado, migraciones aplicadas y `npm run db:usuarios`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearClienteServidor } from '../../src/config/supabase.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { condicionDelDia } from '../../src/controllers/hitos.js';
import { crearBaseDeDatos } from '../../src/persistence/base-de-datos.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { formularioDeRegistro } from '../helpers/fabricas.js';

const servidor = crearClienteServidor();
const baseDeDatos = crearBaseDeDatos(servidor);
const { correo, enviados } = crearCorreoFalso();
// Hoy fijo; por defecto empiezan el 1 de abril: ya pasaron el día 120 y el 181 (DA-49).
const HOY = '2026-11-23';
const control = crearControlIncapacidades({ baseDeDatos, correo, hoy: () => HOY });

const correoColaborador = `prueba.prolongadas.${Date.now()}@sigi.test`;
const CONCEPTO = 'Concepto favorable de rehabilitación, pronóstico de recuperación en seis meses.';
const ids = [];
let receptor;

const registrar = async (dias, fechaInicio = '2026-04-01') => {
  const formulario = formularioDeRegistro({ correoColaborador, diasIncapacidad: String(dias), fechaInicio, fechaRecepcion: fechaInicio });
  const { idIncapacidad } = await control.registrarIncapacidad(formulario, receptor);
  ids.push(idIncapacidad);
  return idIncapacidad;
};
const fila = async (id) =>
  (await servidor.from('incapacidad').select('ibc, valor_empresa, valor_eps, tramite_pension, concepto, falta_concepto, pago_suspendido').eq('id', id).single()).data;

beforeAll(async () => {
  const { data, error } = await servidor.from('usuario').select('id, correo, rol').eq('correo', 'receptor1@sigi.test').maybeSingle();
  if (error || !data) throw new Error('Faltan los usuarios de demostración: ejecute `npm run db:usuarios`');
  receptor = data;
});

afterAll(async () => {
  if (ids.length) await servidor.from('incapacidad').delete().in('id', ids);
  await servidor.from('colaborador').delete().eq('correo', correoColaborador);
});

describe('HU-21 — reconocimiento económico (base de datos)', () => {
  it('guarda el IBC, los valores y el trámite de pensión con dos decimales', async () => {
    const id = await registrar(10);
    await control.calcularReconocimiento(id, { ibc: '3.000.000,50' });
    expect(await fila(id)).toMatchObject({ ibc: 3000000.5, valor_empresa: 200000.03, valor_eps: 536000.09, tramite_pension: false });
    expect((await control.prepararReconocimiento(id)).resultado.valorEmpresa).toBe(20_000_003);
  });

  it('DA-10 — más de 180 días marca el trámite de pensión; un nuevo cálculo reemplaza al anterior', async () => {
    const id = await registrar(200);
    await control.calcularReconocimiento(id, { ibc: '3000000' });
    await control.calcularReconocimiento(id, { ibc: '6000000' });
    expect(await fila(id)).toMatchObject({ ibc: 6000000, tramite_pension: true });
  });

  it('la lista trae las incapacidades con su cálculo', async () => {
    const id = await registrar(5);
    await control.calcularReconocimiento(id, { ibc: '1500000' });
    const { filas, total } = await control.consultarReconocimientos();
    expect(total).toBeGreaterThanOrEqual(1);
    expect(filas.length).toBeLessThanOrEqual(200);
    expect(filas.find((f) => f.idIncapacidad === id)).toMatchObject({ ibc: 1500000, valorEmpresa: 100000 });
  });
});

describe('HU-22 y HU-23 — prolongadas (base de datos)', () => {
  it('HU-22.CA1 — el reporte trae solo las de más de 90 días, con el correo del colaborador', async () => {
    const corta = await registrar(90);
    const larga = await registrar(95);
    const todas = [...(await control.consultarReporteProlongadas('accion')).prolongadas, ...(await control.consultarReporteProlongadas('espera')).prolongadas];
    expect(todas.some((p) => p.idIncapacidad === corta)).toBe(false);
    expect(todas.find((p) => p.idIncapacidad === larga)).toMatchObject({ correoColaborador, diasIncapacidad: 95, estadoConcepto: 'pendiente' });
  });

  it('HU-22.CA2 — guarda el concepto, avisa al colaborador y no admite un segundo', async () => {
    const id = await registrar(130);
    const antes = enviados.length;
    await control.registrarConcepto(id, { concepto: CONCEPTO });
    expect((await fila(id)).concepto).toBe(CONCEPTO);
    expect(enviados.slice(antes).map((m) => m.to)).toEqual([correoColaborador]);
    await expect(control.registrarConcepto(id, { concepto: CONCEPTO })).rejects.toMatchObject({ errores: { estado: expect.any(String) } });
    expect(enviados).toHaveLength(antes + 1);
  });

  it('HU-23.CA1 — guarda la falta una sola vez; registrar el concepto después la resuelve', async () => {
    const id = await registrar(130);
    await control.registrarFaltaConcepto(id);
    expect((await fila(id)).falta_concepto).toBe(true);
    await expect(control.registrarFaltaConcepto(id)).rejects.toMatchObject({ errores: { estado: expect.any(String) } });
    await control.registrarConcepto(id, { concepto: CONCEPTO });
    expect(await fila(id)).toMatchObject({ concepto: CONCEPTO, falta_concepto: false });
    await expect(control.registrarFaltaConcepto(id)).rejects.toMatchObject({ errores: { estado: expect.any(String) } });
  });

  it('no admite concepto ni falta antes del día 120', async () => {
    const id = await registrar(119);
    await expect(control.registrarConcepto(id, { concepto: CONCEPTO })).rejects.toMatchObject({ errores: { estado: expect.any(String) } });
    expect(await baseDeDatos.guardarConcepto(id, CONCEPTO, condicionDelDia(120, HOY))).toBe(false);
    expect(await baseDeDatos.guardarFaltaConcepto(id, condicionDelDia(120, HOY))).toBe(false);
    expect(await fila(id)).toMatchObject({ concepto: null, falta_concepto: false });
    const exacta = await registrar(120);
    expect(await baseDeDatos.guardarFaltaConcepto(exacta, condicionDelDia(120, HOY))).toBe(true);
  });

  it('DA-49 — la base no guarda el concepto ni la falta si aún no se llegó al día 120 por calendario', async () => {
    const id = await registrar(150, '2026-11-22');
    expect(await baseDeDatos.guardarConcepto(id, CONCEPTO, condicionDelDia(120, HOY))).toBe(false);
    expect(await baseDeDatos.guardarFaltaConcepto(id, condicionDelDia(120, HOY))).toBe(false);
    const hoyEs119 = await registrar(150, '2026-07-28');
    expect(await baseDeDatos.guardarFaltaConcepto(hoyEs119, condicionDelDia(120, HOY))).toBe(false);
    const hoyEs120 = await registrar(150, '2026-07-27');
    expect(await baseDeDatos.guardarFaltaConcepto(hoyEs120, condicionDelDia(120, HOY))).toBe(true);
  });

  it('si el correo falla, el concepto y la falta se deshacen', async () => {
    const id = await registrar(130);
    const fallido = crearControlIncapacidades({
      baseDeDatos,
      correo: { ...correo, comunicarConcepto: async () => { throw new Error('SMTP caído'); }, avisarFaltaConcepto: async () => { throw new Error('SMTP caído'); } },
      hoy: () => HOY,
    });
    await expect(fallido.registrarFaltaConcepto(id)).rejects.toMatchObject({ name: 'ErrorDeAviso', deshecho: true, cause: expect.objectContaining({ message: 'SMTP caído' }) });
    expect((await fila(id)).falta_concepto).toBe(false);
    await expect(fallido.registrarConcepto(id, { concepto: CONCEPTO })).rejects.toMatchObject({ name: 'ErrorDeAviso', deshecho: true, cause: expect.objectContaining({ message: 'SMTP caído' }) });
    expect(await fila(id)).toMatchObject({ concepto: null, falta_concepto: false });
  });
});

describe('HU-24 — suspensión del pago (base de datos)', () => {
  it('la guarda solo con más de 180 días y una sola vez', async () => {
    const corta = await registrar(180);
    await expect(control.registrarSuspensionPago(corta)).rejects.toMatchObject({ errores: { suspension: expect.any(String) } });
    expect((await fila(corta)).pago_suspendido).toBe(false);

    const larga = await registrar(200);
    await control.registrarSuspensionPago(larga);
    expect((await fila(larga)).pago_suspendido).toBe(true);
    await expect(control.registrarSuspensionPago(larga)).rejects.toMatchObject({ errores: { suspension: expect.any(String) } });
  });

  it('DA-49 — no la guarda si aún no se llegó al día 181 por calendario', async () => {
    const hoyEs180 = await registrar(200, '2026-05-28');
    expect(await baseDeDatos.guardarSuspensionPago(hoyEs180, condicionDelDia(181, HOY))).toBe(false);
    const hoyEs181 = await registrar(200, '2026-05-27');
    expect(await baseDeDatos.guardarSuspensionPago(hoyEs181, condicionDelDia(181, HOY))).toBe(true);
  });

  it('si el correo falla se deshace la suspensión y se puede reintentar', async () => {
    const id = await registrar(200);
    const original = correo.notificarSuspensionPago;
    correo.notificarSuspensionPago = async () => { throw new Error('SMTP caído'); };
    await expect(control.registrarSuspensionPago(id)).rejects.toMatchObject({ name: 'ErrorDeAviso', deshecho: true, cause: expect.objectContaining({ message: 'SMTP caído' }) });
    expect((await fila(id)).pago_suspendido).toBe(false);
    correo.notificarSuspensionPago = original;
    await control.registrarSuspensionPago(id);
    expect((await fila(id)).pago_suspendido).toBe(true);
  });
});
