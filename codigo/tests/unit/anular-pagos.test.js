// Auditoría de las HU (pendientes) — anular un pago (HU-15) o un pago consignado (HU-25) mal digitado, sin borrarlo,
// y su efecto en la conciliación (HU-26) y el archivo (HU-29). Control con persistencia y correo falsos.
import { beforeEach, describe, expect, it } from 'vitest';
import { leerMotivoAnulacion, MOTIVO_ANULACION_MAXIMO } from '../../src/controllers/anulacion.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { ErrorDeValidacion } from '../../src/controllers/error-de-validacion.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { pagoRegistrado } from '../helpers/fabricas.js';
import { USUARIOS } from '../helpers/sesion-falsa.js';

const MOTIVO = 'Se digitó 1.250.000 y eran 125.000';
let baseDeDatos;
let control;

beforeEach(() => {
  baseDeDatos = crearBaseDeDatosFalsa();
  control = crearControlIncapacidades({ baseDeDatos, correo: crearCorreoFalso().correo, hoy: () => '2026-11-20' });
});

const errores = async (promesa) => {
  const error = await promesa.catch((e) => e);
  expect(error).toBeInstanceOf(ErrorDeValidacion);
  return error.errores;
};
const incapacidadDe = (idPago) => baseDeDatos.pagos.find((p) => p.idPago === idPago).idIncapacidad;
const consignar = (filas, entidad = '2') =>
  control.registrarPagosConsignados(
    { entidad, colaborador: filas.map((f) => f[0]), dias: filas.map((f) => f[1]), valor: filas.map((f) => f[2]) },
    USUARIOS.contabilidad,
  );

describe('leerMotivoAnulacion', () => {
  it.each([
    ['', /Escriba por qué/],
    ['   ', /Escriba por qué/],
    ['corto', /al menos 10/],
    ['x'.repeat(MOTIVO_ANULACION_MAXIMO + 1), /hasta 500/],
    ['Motivo con \u0001 control', /no válidos/],
  ])('rechaza %j', (texto, mensaje) => {
    expect(leerMotivoAnulacion(texto).error).toMatch(mensaje);
  });

  it('acepta de 10 a 500 caracteres (cuenta caracteres, no unidades UTF-16) y recorta los extremos', () => {
    expect(leerMotivoAnulacion(`  ${MOTIVO}\n`)).toEqual({ valor: MOTIVO });
    expect(leerMotivoAnulacion('🙂'.repeat(500)).valor).toHaveLength(1000);
    expect(leerMotivoAnulacion('Línea uno\nlínea dos')).toEqual({ valor: 'Línea uno\nlínea dos' });
  });
});

describe('HU-15 (auditoría) — anular un pago registrado', () => {
  it('el único pago: queda anulado con quién, cuándo y el motivo, y la incapacidad vuelve a «cobrada»', async () => {
    const idPago = await pagoRegistrado(baseDeDatos, { colaborador: 'Ana Gómez', valor: '1250000.00' });
    const id = incapacidadDe(idPago);
    // Una cobrada real tiene su tiempo de pago y su fecha (DA-38): los usa el seguimiento.
    Object.assign(baseDeDatos.incapacidades.find((i) => i.idIncapacidad === id), { tiempoPago: 30, fechaCobrada: '2026-11-05' });
    expect(await control.anularPago(String(id), String(idPago), { motivo: MOTIVO }, USUARIOS.auxiliar)).toEqual({ idIncapacidad: id, idPago, estado: 'cobrada' });

    const { incapacidad, totalPagado, pagosVigentes, anulables, puedeRegistrarPago } = await control.prepararCobro(String(id));
    expect(incapacidad.estado).toBe('cobrada');
    expect(incapacidad.pagos).toEqual([
      expect.objectContaining({ idPago, anulacion: { fecha: expect.any(String), motivo: MOTIVO, por: 'auxiliar@sigi.test' } }),
    ]);
    expect({ totalPagado, pagosVigentes, anulables, puedeRegistrarPago }).toEqual({ totalPagado: '0.00', pagosVigentes: 0, anulables: [], puedeRegistrarPago: true });
    expect(baseDeDatos.pagos).toHaveLength(1); // no se borró
    // Vuelve a los pendientes de pago (seguimiento, HU-16).
    expect((await control.consultarPendientesDePago()).pendientes.map((p) => p.idIncapacidad)).toEqual([id]);
  });

  it('con otro pago vigente sigue «pagada» y el total cuenta solo los vigentes', async () => {
    const primero = await pagoRegistrado(baseDeDatos, { colaborador: 'Ana Gómez', valor: '800000.00' });
    const id = incapacidadDe(primero);
    const segundo = await baseDeDatos.guardarPago(id, { valor: '450000.00', fechaPago: '2026-11-15' }, 'id-auxiliar');
    expect((await control.anularPago(String(id), String(primero), { motivo: MOTIVO }, USUARIOS.auxiliar)).estado).toBe('pagada');
    const cobro = await control.prepararCobro(String(id));
    expect(cobro).toMatchObject({ totalPagado: '450000.00', pagosVigentes: 1, anulables: [segundo] });
  });

  it('valida el motivo y no anula nada', async () => {
    const idPago = await pagoRegistrado(baseDeDatos, { colaborador: 'Ana Gómez', valor: '1000.00' });
    expect(await errores(control.anularPago(String(incapacidadDe(idPago)), String(idPago), { motivo: 'corto' }, USUARIOS.auxiliar))).toEqual({
      motivo: 'Escriba el motivo con al menos 10 caracteres.',
    });
    expect(baseDeDatos.pagos[0].anulacion).toBeUndefined();
  });

  it.each([
    ['ya anulado', async (id, idPago) => control.anularPago(String(id), String(idPago), { motivo: MOTIVO }, USUARIOS.auxiliar), /ya está anulado/],
    ['conciliado', async (_id, idPago) => Object.assign(baseDeDatos.pagos.find((p) => p.idPago === idPago), { conciliado: true }), /conciliación/],
    ['con el archivo preparado', async (id) => Object.assign(baseDeDatos.incapacidades.find((i) => i.idIncapacidad === id), { fechaArchivoPreparado: '2026-11-19T10:00:00Z' }), /archivo/],
  ])('no se anula un pago %s', async (_caso, preparar, mensaje) => {
    const idPago = await pagoRegistrado(baseDeDatos, { colaborador: 'Ana Gómez', valor: '1000.00' });
    const id = incapacidadDe(idPago);
    await preparar(id, idPago);
    expect((await errores(control.anularPago(String(id), String(idPago), { motivo: MOTIVO }, USUARIOS.auxiliar))).anulacion).toMatch(mensaje);
  });

  it('un pago de otra incapacidad, un número no válido o una incapacidad que no existe', async () => {
    const uno = await pagoRegistrado(baseDeDatos, { colaborador: 'Ana Gómez', valor: '1000.00' });
    const otro = await pagoRegistrado(baseDeDatos, { colaborador: 'Luis Gil', valor: '2000.00' });
    expect((await errores(control.anularPago(String(incapacidadDe(uno)), String(otro), { motivo: MOTIVO }, USUARIOS.auxiliar))).anulacion).toMatch(/no es de esta incapacidad/);
    expect((await errores(control.anularPago(String(incapacidadDe(uno)), 'abc', { motivo: MOTIVO }, USUARIOS.auxiliar))).anulacion).toMatch(/no es de esta incapacidad/);
    expect(await control.anularPago('999', String(uno), { motivo: MOTIVO }, USUARIOS.auxiliar)).toBeNull();
  });

  it('si otro usuario lo concilió entre la consulta y la anulación, lo explica con lo de ahora', async () => {
    const idPago = await pagoRegistrado(baseDeDatos, { colaborador: 'Ana Gómez', valor: '1000.00' });
    const original = baseDeDatos.anularPago;
    baseDeDatos.anularPago = async (...args) => {
      baseDeDatos.pagos[0].conciliado = true; // la conciliación llegó primero
      return original(...args);
    };
    expect((await errores(control.anularPago(String(incapacidadDe(idPago)), String(idPago), { motivo: MOTIVO }, USUARIOS.auxiliar))).anulacion).toMatch(/conciliación/);
  });

  it('HU-29 — un pago anulado no bloquea el archivo: cuentan solo los vigentes y conciliados', async () => {
    const bueno = await pagoRegistrado(baseDeDatos, { colaborador: 'Ana Gómez', valor: '125000.00' });
    const id = incapacidadDe(bueno);
    const malo = await baseDeDatos.guardarPago(id, { valor: '1250000.00', fechaPago: '2026-11-11' }, 'id-auxiliar');
    await control.anularPago(String(id), String(malo), { motivo: MOTIVO }, USUARIOS.auxiliar);
    baseDeDatos.pagos.find((p) => p.idPago === bueno).conciliado = true; // solo el bueno se concilió
    expect(await control.archivarIncapacidad(String(id), USUARIOS.auxiliar)).toMatchObject({ idIncapacidad: id });
  });

  it('HU-29 — sin pagos vigentes no se archiva (ya no está pagada)', async () => {
    const idPago = await pagoRegistrado(baseDeDatos, { colaborador: 'Ana Gómez', valor: '1000.00' });
    const id = incapacidadDe(idPago);
    await control.anularPago(String(id), String(idPago), { motivo: MOTIVO }, USUARIOS.auxiliar);
    await expect(control.archivarIncapacidad(String(id), USUARIOS.auxiliar)).rejects.toBeInstanceOf(ErrorDeValidacion);
  });

  it('HU-26 — un pago anulado ya no aparece por conciliar', async () => {
    const idPago = await pagoRegistrado(baseDeDatos, { colaborador: 'Ana Gómez', valor: '1000.00' });
    await control.anularPago(String(incapacidadDe(idPago)), String(idPago), { motivo: MOTIVO }, USUARIOS.auxiliar);
    expect(await baseDeDatos.consultarPagosPorConciliar(2)).toEqual([]);
  });
});

describe('HU-25 (auditoría) — anular un pago consignado', () => {
  it('queda anulado con quién, cuándo y el motivo; ya no queda por identificar', async () => {
    await consignar([['Ana Gómez', '10', '1.250.000'], ['Luis Gil', '5', '300.000']]);
    expect(await control.anularPagoConsignado('1', { motivo: MOTIVO }, USUARIOS.contabilidad)).toEqual({ id: 1 });
    expect(baseDeDatos.pagosConsignados).toHaveLength(2); // no se borró
    expect((await baseDeDatos.obtenerPagosConsignados(2)).map((p) => p.id)).toEqual([2]);
    expect(await baseDeDatos.contarPorIdentificar()).toEqual({ 2: 1 });
    const { recientes } = await control.prepararPagosConsignados();
    expect(recientes.find((p) => p.id === 1).anulacion).toEqual({ fecha: expect.any(String), motivo: MOTIVO, por: 'contabilidad@sigi.test' });
  });

  it('HU-26 — un consignado anulado no deja saldos pendientes: la entidad queda conciliada', async () => {
    const idPago = await pagoRegistrado(baseDeDatos, { colaborador: 'Ana Gómez', valor: '125000.00' });
    await consignar([['Ana Gómez', '10', '125.000'], ['Ana Gómez', '10', '1.250.000']]); // el segundo, mal digitado
    await control.anularPagoConsignado('2', { motivo: MOTIVO }, USUARIOS.contabilidad);
    const resultado = await control.identificarPagos({ entidad: '2', pagos: [String(idPago)] }, USUARIOS.auxiliar);
    expect(resultado).toMatchObject({ conciliada: true });
    expect(baseDeDatos.conciliaciones[0].saldosPendientes).toEqual([]);
  });

  it('sin anular, el mal digitado sí quedaría como saldo pendiente', async () => {
    const idPago = await pagoRegistrado(baseDeDatos, { colaborador: 'Ana Gómez', valor: '125000.00' });
    await consignar([['Ana Gómez', '10', '125.000'], ['Ana Gómez', '10', '1.250.000']]);
    const resultado = await control.identificarPagos({ entidad: '2', pagos: [String(idPago)] }, USUARIOS.auxiliar);
    expect(resultado).toMatchObject({ conciliada: false });
    expect(baseDeDatos.conciliaciones[0].saldosPendientes).toHaveLength(1);
  });

  it('no se anula si ya se identificó en una conciliación, si ya está anulado ni con un motivo no válido', async () => {
    const idPago = await pagoRegistrado(baseDeDatos, { colaborador: 'Ana Gómez', valor: '125000.00' });
    await consignar([['Ana Gómez', '10', '125.000'], ['Luis Gil', '5', '300.000']]);
    await control.identificarPagos({ entidad: '2', pagos: [String(idPago)] }, USUARIOS.auxiliar);
    expect((await errores(control.anularPagoConsignado('1', { motivo: MOTIVO }, USUARIOS.contabilidad))).anulacion).toMatch(/conciliación/);
    expect(await errores(control.anularPagoConsignado('2', { motivo: '' }, USUARIOS.contabilidad))).toEqual({ motivo: 'Escriba por qué se anula.' });
    await control.anularPagoConsignado('2', { motivo: MOTIVO }, USUARIOS.contabilidad);
    expect((await errores(control.anularPagoConsignado('2', { motivo: MOTIVO }, USUARIOS.contabilidad))).anulacion).toMatch(/ya está anulado/);
  });

  it('uno que no existe o un número no válido: null', async () => {
    expect(await control.anularPagoConsignado('99', { motivo: MOTIVO }, USUARIOS.contabilidad)).toBeNull();
    expect(await control.anularPagoConsignado('1; drop', { motivo: MOTIVO }, USUARIOS.contabilidad)).toBeNull();
  });
});
