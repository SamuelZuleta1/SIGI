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
let auxiliar;

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
  const otro = await servidor.from('usuario').select('id, correo, rol').eq('correo', 'auxiliar1@sigi.test').maybeSingle();
  if (otro.error || !otro.data) throw new Error('Faltan los usuarios de demostración: ejecute `npm run db:usuarios`');
  auxiliar = otro.data;
});

afterAll(async () => {
  if (ids.length) await servidor.from('incapacidad').delete().in('id', ids);
  await servidor.from('colaborador').delete().eq('correo', correoColaborador);
});

describe('HU-21 — reconocimiento económico (base de datos)', () => {
  it('guarda el IBC, los valores y el trámite de pensión con dos decimales', async () => {
    const id = await registrar(10);
    await control.calcularReconocimiento(id, { ibc: '3.000.000,50' }, auxiliar);
    expect(await fila(id)).toMatchObject({ ibc: 3000000.5, valor_empresa: 200000.03, valor_eps: 536000.09, tramite_pension: false });
    expect((await control.prepararReconocimiento(id)).resultado.valorEmpresa).toBe(20_000_003);
  });

  it('DA-10 — más de 180 días marca el trámite de pensión; un nuevo cálculo reemplaza al anterior', async () => {
    const id = await registrar(200);
    await control.calcularReconocimiento(id, { ibc: '3000000' }, auxiliar);
    await control.calcularReconocimiento(id, { ibc: '6000000' }, auxiliar);
    expect(await fila(id)).toMatchObject({ ibc: 6000000, tramite_pension: true });
  });

  it('DA-53 — la base no guarda un cálculo sobre una incapacidad pagada; sobre una registrada (estado null), sí', async () => {
    const id = await registrar(10);
    const calculo = { ibc: '1000000.00', valorEmpresa: '66666.67', valorEPS: '178666.67', tramitePension: false };
    expect(await baseDeDatos.guardarCalculo(id, calculo, auxiliar.id)).toBe(true);
    const { error } = await servidor.from('incapacidad').update({ estado: 'pagada', tiempo_pago: 30, fecha_cobrada: '2026-04-05' }).eq('id', id);
    expect(error).toBeNull();
    expect(await baseDeDatos.guardarCalculo(id, { ...calculo, ibc: '2000000.00' }, auxiliar.id)).toBe(false);
    expect((await fila(id)).ibc).toBe(1000000);
  });

  it('la lista trae las incapacidades con su cálculo', async () => {
    const id = await registrar(5);
    await control.calcularReconocimiento(id, { ibc: '1500000' }, auxiliar);
    const { filas, total } = await control.consultarReconocimientos();
    expect(total).toBeGreaterThanOrEqual(1);
    expect(filas.length).toBeLessThanOrEqual(200);
    expect(filas.find((f) => f.idIncapacidad === id)).toMatchObject({ ibc: 1500000, valorEmpresa: 100000 });
  });
});

describe('Lista de reconocimiento — búsqueda (base de datos)', () => {
  it('busca por n.º exacto y por parte del nombre del colaborador (sin tildes ni mayúsculas)', async () => {
    const id = await registrar(5);
    const porNumero = await baseDeDatos.consultarParaReconocimiento(200, { id });
    expect(porNumero.filas.map((f) => f.idIncapacidad)).toEqual([id]);
    // Sin tildes ni mayúsculas, como HU-11: el Control filtra los colaboradores y la base recibe sus ids.
    const porNombre = await control.consultarReconocimientos('ANA MARIA GOMEZ');
    expect(porNombre.filas.some((f) => f.idIncapacidad === id)).toBe(true);
    expect(porNombre.filas.every((f) => /ana maría gómez/i.test(f.colaborador))).toBe(true);
  });

  it('los comodines que escribe el usuario son texto, no comodines', async () => {
    expect((await control.consultarReconocimientos('%_%')).filas).toEqual([]);
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
    await control.registrarConcepto(id, { concepto: CONCEPTO }, auxiliar);
    expect((await fila(id)).concepto).toBe(CONCEPTO);
    expect(enviados.slice(antes).map((m) => m.to)).toEqual([correoColaborador]);
    await expect(control.registrarConcepto(id, { concepto: CONCEPTO }, auxiliar)).rejects.toMatchObject({ errores: { estado: expect.any(String) } });
    expect(enviados).toHaveLength(antes + 1);
  });

  it('HU-23.CA1 — guarda la falta una sola vez; registrar el concepto después la resuelve', async () => {
    const id = await registrar(130);
    await control.registrarFaltaConcepto(id, auxiliar);
    expect((await fila(id)).falta_concepto).toBe(true);
    await expect(control.registrarFaltaConcepto(id, auxiliar)).rejects.toMatchObject({ errores: { estado: expect.any(String) } });
    await control.registrarConcepto(id, { concepto: CONCEPTO }, auxiliar);
    expect(await fila(id)).toMatchObject({ concepto: CONCEPTO, falta_concepto: false });
    await expect(control.registrarFaltaConcepto(id, auxiliar)).rejects.toMatchObject({ errores: { estado: expect.any(String) } });
  });

  it('no admite concepto ni falta antes del día 120', async () => {
    const id = await registrar(119);
    await expect(control.registrarConcepto(id, { concepto: CONCEPTO }, auxiliar)).rejects.toMatchObject({ errores: { estado: expect.any(String) } });
    expect(await baseDeDatos.guardarConcepto(id, CONCEPTO, condicionDelDia(120, HOY), auxiliar.id)).toBe(false);
    expect(await baseDeDatos.guardarFaltaConcepto(id, condicionDelDia(120, HOY), auxiliar.id)).toBe(false);
    expect(await fila(id)).toMatchObject({ concepto: null, falta_concepto: false });
    const exacta = await registrar(120);
    expect(await baseDeDatos.guardarFaltaConcepto(exacta, condicionDelDia(120, HOY), auxiliar.id)).toBe(true);
  });

  it('DA-49 — la base no guarda el concepto ni la falta si aún no se llegó al día 120 por calendario', async () => {
    const id = await registrar(150, '2026-11-22');
    expect(await baseDeDatos.guardarConcepto(id, CONCEPTO, condicionDelDia(120, HOY), auxiliar.id)).toBe(false);
    expect(await baseDeDatos.guardarFaltaConcepto(id, condicionDelDia(120, HOY), auxiliar.id)).toBe(false);
    const hoyEs119 = await registrar(150, '2026-07-28');
    expect(await baseDeDatos.guardarFaltaConcepto(hoyEs119, condicionDelDia(120, HOY), auxiliar.id)).toBe(false);
    const hoyEs120 = await registrar(150, '2026-07-27');
    expect(await baseDeDatos.guardarFaltaConcepto(hoyEs120, condicionDelDia(120, HOY), auxiliar.id)).toBe(true);
  });

  it('si el correo falla, el concepto y la falta se deshacen', async () => {
    const id = await registrar(130);
    const fallido = crearControlIncapacidades({
      baseDeDatos,
      correo: { ...correo, comunicarConcepto: async () => { throw new Error('SMTP caído'); }, avisarFaltaConcepto: async () => { throw new Error('SMTP caído'); } },
      hoy: () => HOY,
    });
    await expect(fallido.registrarFaltaConcepto(id, auxiliar)).rejects.toMatchObject({ name: 'ErrorDeAviso', deshecho: true, cause: expect.objectContaining({ message: 'SMTP caído' }) });
    expect((await fila(id)).falta_concepto).toBe(false);
    await expect(fallido.registrarConcepto(id, { concepto: CONCEPTO }, auxiliar)).rejects.toMatchObject({ name: 'ErrorDeAviso', deshecho: true, cause: expect.objectContaining({ message: 'SMTP caído' }) });
    expect(await fila(id)).toMatchObject({ concepto: null, falta_concepto: false });
  });
});

describe('DA-23 — auditoría del concepto, la falta, el cálculo y la suspensión (base de datos)', () => {
  const auditoria = async (id) =>
    (await servidor.from('incapacidad').select('fecha_concepto, concepto_por, fecha_falta_concepto, falta_concepto_por, fecha_calculo, calculo_por, fecha_suspension, suspension_por').eq('id', id).single()).data;

  it('guarda quién y cuándo en cada registro y la falta se conserva al llegar el concepto', async () => {
    const id = await registrar(200);
    await control.registrarFaltaConcepto(id, auxiliar);
    await control.registrarConcepto(id, { concepto: CONCEPTO }, auxiliar);
    await control.registrarSuspensionPago(id, auxiliar);
    await control.calcularReconocimiento(id, { ibc: '3000000' }, auxiliar);
    expect(await auditoria(id)).toMatchObject({
      fecha_concepto: expect.any(String), concepto_por: auxiliar.id,
      fecha_falta_concepto: expect.any(String), falta_concepto_por: auxiliar.id,
      fecha_calculo: expect.any(String), calculo_por: auxiliar.id,
      fecha_suspension: expect.any(String), suspension_por: auxiliar.id,
    });
  });

  it('el deshacer limpia la fecha y el usuario', async () => {
    const id = await registrar(200);
    await baseDeDatos.guardarFaltaConcepto(id, condicionDelDia(120, HOY), auxiliar.id);
    await baseDeDatos.deshacerFaltaConcepto(id);
    await baseDeDatos.guardarSuspensionPago(id, condicionDelDia(181, HOY), auxiliar.id);
    await baseDeDatos.deshacerSuspensionPago(id);
    await baseDeDatos.guardarConcepto(id, CONCEPTO, condicionDelDia(120, HOY), auxiliar.id);
    await baseDeDatos.deshacerConcepto(id, CONCEPTO, false);
    expect(await auditoria(id)).toMatchObject({
      fecha_concepto: null, concepto_por: null, fecha_falta_concepto: null, falta_concepto_por: null, fecha_suspension: null, suspension_por: null,
    });
  });

  it.each([
    ['concepto sin fecha ni usuario', { concepto: 'Concepto sin auditoría.' }],
    ['falta sin fecha', { falta_concepto: true }],
    ['IBC sin fecha del cálculo', { ibc: 1000 }],
    ['suspensión sin fecha', { pago_suspendido: true }],
    ['fecha sin usuario', { concepto: 'Concepto con fecha y sin usuario.', fecha_concepto: new Date().toISOString() }],
  ])('los checks rechazan %s', async (_, cambio) => {
    const id = await registrar(200);
    const { error } = await servidor.from('incapacidad').update(cambio).eq('id', id);
    expect(error).toMatchObject({ code: '23514' });
  });
});

describe('HU-24 — suspensión del pago (base de datos)', () => {
  it('la guarda solo con más de 180 días y una sola vez', async () => {
    const corta = await registrar(180);
    await expect(control.registrarSuspensionPago(corta, auxiliar)).rejects.toMatchObject({ errores: { suspension: expect.any(String) } });
    expect((await fila(corta)).pago_suspendido).toBe(false);

    const larga = await registrar(200);
    await control.registrarSuspensionPago(larga, auxiliar);
    expect((await fila(larga)).pago_suspendido).toBe(true);
    await expect(control.registrarSuspensionPago(larga, auxiliar)).rejects.toMatchObject({ errores: { suspension: expect.any(String) } });
  });

  it('DA-49 — no la guarda si aún no se llegó al día 181 por calendario', async () => {
    const hoyEs180 = await registrar(200, '2026-05-28');
    expect(await baseDeDatos.guardarSuspensionPago(hoyEs180, condicionDelDia(181, HOY), auxiliar.id)).toBe(false);
    const hoyEs181 = await registrar(200, '2026-05-27');
    expect(await baseDeDatos.guardarSuspensionPago(hoyEs181, condicionDelDia(181, HOY), auxiliar.id)).toBe(true);
  });

  it('si el correo falla se deshace la suspensión y se puede reintentar', async () => {
    const id = await registrar(200);
    const original = correo.notificarSuspensionPago;
    correo.notificarSuspensionPago = async () => { throw new Error('SMTP caído'); };
    await expect(control.registrarSuspensionPago(id, auxiliar)).rejects.toMatchObject({ name: 'ErrorDeAviso', deshecho: true, cause: expect.objectContaining({ message: 'SMTP caído' }) });
    expect((await fila(id)).pago_suspendido).toBe(false);
    correo.notificarSuspensionPago = original;
    await control.registrarSuspensionPago(id, auxiliar);
    expect((await fila(id)).pago_suspendido).toBe(true);
  });
});
