// HU-26 — identificar los pagos y conciliar (DS-11, CU-15), Control con persistencia y correo falsos (DA-11, DA-56).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { compararPagos, leerPagosElegidos } from '../../src/controllers/conciliacion.controller.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { ErrorDeAviso } from '../../src/controllers/error-de-aviso.js';
import { ErrorDeValidacion } from '../../src/controllers/error-de-validacion.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso, DESTINATARIOS } from '../helpers/correo-falso.js';
import { pagoRegistrado } from '../helpers/fabricas.js';
import { USUARIOS } from '../helpers/sesion-falsa.js';

let baseDeDatos;
let correo;
let enviados;
let control;

const consignar = (filas, entidad = '2') =>
  control.registrarPagosConsignados(
    { entidad, colaborador: filas.map((f) => f[0]), dias: filas.map((f) => f[1]), valor: filas.map((f) => f[2]) },
    USUARIOS.contabilidad,
  );

const fallaValidacion = async (promesa) => {
  const error = await promesa.catch((e) => e);
  expect(error).toBeInstanceOf(ErrorDeValidacion);
  return error.errores;
};

beforeEach(() => {
  baseDeDatos = crearBaseDeDatosFalsa();
  ({ correo, enviados } = crearCorreoFalso());
  control = crearControlIncapacidades({ baseDeDatos, correo });
});

describe('HU-26 — compararPagos (DA-11)', () => {
  it('identifica por colaborador y valor, sin importar tildes, mayúsculas ni espacios', () => {
    const { pares, consignadosSinIdentificar, pagosSinConsignacion } = compararPagos(
      [{ id: 1, colaborador: 'ANA  GOMEZ', valor: '1250000.00' }],
      [{ idPago: 7, colaborador: 'Ana Gómez', valor: '1250000' }],
    );
    expect(pares.map((p) => [p.consignado.id, p.pago.idPago])).toEqual([[1, 7]]);
    expect(consignadosSinIdentificar).toEqual([]);
    expect(pagosSinConsignacion).toEqual([]);
  });

  it('el valor debe coincidir al centavo y el colaborador completo', () => {
    const { pares, consignadosSinIdentificar, pagosSinConsignacion } = compararPagos(
      [{ id: 1, colaborador: 'Ana Gómez', valor: '1250000.50' }, { id: 2, colaborador: 'Luis Pérez', valor: '100.00' }],
      [{ idPago: 7, colaborador: 'Ana Gómez', valor: '1250000.00' }, { idPago: 8, colaborador: 'Luis', valor: '100.00' }],
    );
    expect(pares).toEqual([]);
    expect(consignadosSinIdentificar.map((c) => c.id)).toEqual([1, 2]);
    expect(pagosSinConsignacion.map((p) => p.idPago)).toEqual([7, 8]);
  });

  it('cada pago se usa una sola vez: dos consignados iguales necesitan dos pagos', () => {
    const { pares, consignadosSinIdentificar } = compararPagos(
      [{ id: 1, colaborador: 'Ana Gómez', valor: '500.00' }, { id: 2, colaborador: 'Ana Gómez', valor: '500.00' }],
      [{ idPago: 7, colaborador: 'Ana Gómez', valor: '500.00' }],
    );
    expect(pares.map((p) => p.consignado.id)).toEqual([1]);
    expect(consignadosSinIdentificar.map((c) => c.id)).toEqual([2]);
  });
});

describe('HU-26 — leerPagosElegidos', () => {
  it('acepta uno o varios ids y quita los repetidos', () => {
    expect(leerPagosElegidos('3')).toEqual([3]);
    expect(leerPagosElegidos(['3', '5', '3'])).toEqual([3, 5]);
    expect(leerPagosElegidos(undefined)).toEqual([]);
  });

  it.each([[['abc']], [['0']], [['-1']], [['1e3']], [[{}]]])('rechaza %j', (valor) => {
    expect(leerPagosElegidos(valor)).toBeNull();
  });
});

describe('HU-26 — identificar los pagos y conciliar', () => {
  it('HU-26.CA1 — obtiene los consignados de la entidad elegida y los compara con los pagos registrados', async () => {
    await consignar([['Ana Gómez', '10', '1.250.000']]);
    await consignar([['Otra Persona', '3', '90.000']], '3');
    const pagoAna = await pagoRegistrado(baseDeDatos, { colaborador: 'Ana Gómez', valor: '1250000.00' });
    await pagoRegistrado(baseDeDatos, { colaborador: 'Pagado Por Sanitas', entidad: 3, valor: '90000.00' });

    const vista = await control.prepararConciliacion('2');
    expect(vista.entidad.nombre).toBe('Nueva EPS');
    expect(vista.consignados.map((c) => c.colaborador)).toEqual(['Ana Gómez']);
    expect(vista.pagos.map((p) => p.idPago)).toEqual([pagoAna]);
    expect(vista.coincidencias).toEqual({ consignados: [1], pagos: [pagoAna] });
    expect(vista.entidades.find((e) => e.id === 3).porIdentificar).toBe(1);
  });

  it('HU-26.CA2 — todo identificado: guarda la conciliación, marca los pagos conciliados y envía el detalle a Contabilidad', async () => {
    await consignar([['Ana Gómez', '10', '1.250.000'], ['Luis Pérez', '3', '420.000,50']]);
    enviados.length = 0;
    const p1 = await pagoRegistrado(baseDeDatos, { colaborador: 'Ana Gómez', valor: '1250000.00' });
    const p2 = await pagoRegistrado(baseDeDatos, { colaborador: 'Luis Perez', valor: '420000.50' });

    const resultado = await control.identificarPagos({ entidad: '2', pagos: [String(p1), String(p2)] }, USUARIOS.auxiliar);
    expect(resultado).toMatchObject({ idConciliacion: 1, conciliada: true });
    expect(baseDeDatos.conciliaciones[0]).toMatchObject({ entidadId: 2, saldosPendientes: [], creadoPor: 'id-auxiliar' });
    expect(baseDeDatos.conciliaciones[0].detalle).toHaveLength(2);
    expect(baseDeDatos.pagos.every((p) => p.conciliado && p.conciliacionId === 1)).toBe(true);
    expect(baseDeDatos.pagosConsignados.every((p) => p.conciliacionId === 1)).toBe(true);

    expect(enviados).toHaveLength(1);
    expect(enviados[0].to).toBe(DESTINATARIOS.contabilidad);
    expect(enviados[0].subject).toBe('[SIGI] Detalle conciliado — Nueva EPS');
    expect(enviados[0].text).toContain('Luis Pérez · 3 día(s) · $ 420.000,50');
    expect(enviados[0].text).toContain('Total: $ 1.670.000,50');
    expect(enviados[0].attachments ?? []).toHaveLength(0);
  });

  it('HU-26.CA3 — quedan saldos: los guarda, los notifica a Contabilidad y concilia lo que sí coincidió', async () => {
    await consignar([['Ana Gómez', '10', '1.250.000'], ['Desconocido Uno', '2', '80.000']]);
    enviados.length = 0;
    const p1 = await pagoRegistrado(baseDeDatos, { colaborador: 'Ana Gómez', valor: '1250000.00' });
    const p2 = await pagoRegistrado(baseDeDatos, { colaborador: 'Marta Ríos', valor: '300000.00' });

    const resultado = await control.identificarPagos({ entidad: '2', pagos: [String(p1), String(p2)] }, USUARIOS.auxiliar);
    expect(resultado.conciliada).toBe(false);
    const [conciliacion] = baseDeDatos.conciliaciones;
    expect(conciliacion.detalle.map((d) => d.colaborador)).toEqual(['Ana Gómez']);
    expect(conciliacion.saldosPendientes).toMatchObject([
      { tipo: 'consignado', colaborador: 'Desconocido Uno', diasPagados: 2, valor: '80000.00' },
      { tipo: 'pago', colaborador: 'Marta Ríos', idPago: p2, valor: '300000.00' },
    ]);
    // Lo identificado queda conciliado; lo demás sigue pendiente para otra conciliación.
    expect(baseDeDatos.pagos.find((p) => p.idPago === p1).conciliado).toBe(true);
    expect(baseDeDatos.pagos.find((p) => p.idPago === p2).conciliado).toBe(false);
    expect((await baseDeDatos.obtenerPagosConsignados(2)).map((c) => c.colaborador)).toEqual(['Desconocido Uno']);

    expect(enviados).toHaveLength(1);
    expect(enviados[0].to).toBe(DESTINATARIOS.contabilidad);
    expect(enviados[0].subject).toBe('[SIGI] Saldos pendientes por identificar — Nueva EPS');
    expect(enviados[0].text).toContain('Se identificaron y conciliaron 1 pago(s).');
    expect(enviados[0].text).toContain('Desconocido Uno · 2 día(s) · $ 80.000');
    expect(enviados[0].text).toContain(`Marta Ríos · incapacidad n.º`);
  });

  it('HU-26.CA3 — sin pagos elegidos, todos los consignados quedan como saldos', async () => {
    await consignar([['Ana Gómez', '10', '1.250.000']]);
    await pagoRegistrado(baseDeDatos, { colaborador: 'Ana Gómez', valor: '1250000.00' });
    const resultado = await control.identificarPagos({ entidad: '2' }, USUARIOS.auxiliar);
    expect(resultado.conciliada).toBe(false);
    expect(baseDeDatos.conciliaciones[0].detalle).toEqual([]);
    expect(baseDeDatos.pagos[0].conciliado).toBe(false);
  });

  it('un pago desmarcado no se concilia aunque coincida', async () => {
    await consignar([['Ana Gómez', '10', '1.250.000'], ['Luis Pérez', '3', '420.000']]);
    const p1 = await pagoRegistrado(baseDeDatos, { colaborador: 'Ana Gómez', valor: '1250000.00' });
    await pagoRegistrado(baseDeDatos, { colaborador: 'Luis Pérez', valor: '420000.00' });
    await control.identificarPagos({ entidad: '2', pagos: String(p1) }, USUARIOS.auxiliar);
    expect(baseDeDatos.conciliaciones[0].saldosPendientes.map((s) => s.colaborador)).toEqual(['Luis Pérez']);
    expect(baseDeDatos.pagos.map((p) => p.conciliado)).toEqual([true, false]);
  });

  it('sin entidad válida, o sin consignados por identificar, no guarda nada', async () => {
    expect(await fallaValidacion(control.identificarPagos({ entidad: '99' }, USUARIOS.auxiliar))).toHaveProperty('entidad');
    expect(await fallaValidacion(control.identificarPagos({ entidad: '2' }, USUARIOS.auxiliar))).toEqual({
      entidad: 'Nueva EPS no tiene pagos consignados por identificar.',
    });
    expect(baseDeDatos.conciliaciones).toHaveLength(0);
    expect(enviados).toHaveLength(0);
  });

  it('un pago de otra entidad o ya conciliado no se puede elegir', async () => {
    await consignar([['Ana Gómez', '10', '1.250.000']]);
    const deSanitas = await pagoRegistrado(baseDeDatos, { colaborador: 'Ana Gómez', entidad: 3, valor: '1250000.00' });
    const errores = await fallaValidacion(control.identificarPagos({ entidad: '2', pagos: String(deSanitas) }, USUARIOS.auxiliar));
    expect(errores).toHaveProperty('cambio');
    expect(await fallaValidacion(control.identificarPagos({ entidad: '2', pagos: 'x' }, USUARIOS.auxiliar))).toHaveProperty('pagos');
    expect(baseDeDatos.conciliaciones).toHaveLength(0);
  });

  it('si los consignados cambiaron entre la comparación y el guardado, no guarda nada (409)', async () => {
    await consignar([['Ana Gómez', '10', '1.250.000']]);
    const p1 = await pagoRegistrado(baseDeDatos, { colaborador: 'Ana Gómez', valor: '1250000.00' });
    const original = baseDeDatos.obtenerPagosConsignados;
    // Otra lista llega justo después de leer los consignados.
    baseDeDatos.obtenerPagosConsignados = async (id) => {
      const leidos = await original(id);
      baseDeDatos.pagosConsignados.push({ id: 99, entidadId: 2, colaborador: 'Nuevo', diasPagados: 1, valor: '1.00', creadoEn: new Date().toISOString() });
      return leidos;
    };
    const errores = await fallaValidacion(control.identificarPagos({ entidad: '2', pagos: String(p1) }, USUARIOS.auxiliar));
    expect(errores).toHaveProperty('cambio');
    expect(baseDeDatos.conciliaciones).toHaveLength(0);
    expect(baseDeDatos.pagos[0].conciliado).toBe(false);
  });

  it('si el correo a Contabilidad falla, se deshace todo y se puede reintentar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await consignar([['Ana Gómez', '10', '1.250.000']]);
    const p1 = await pagoRegistrado(baseDeDatos, { colaborador: 'Ana Gómez', valor: '1250000.00' });
    correo.enviarDetalleConciliado = async () => { throw new Error('SMTP caído'); };
    const error = await control.identificarPagos({ entidad: '2', pagos: String(p1) }, USUARIOS.auxiliar).catch((e) => e);
    expect(error).toBeInstanceOf(ErrorDeAviso);
    expect(error.deshecho).toBe(true);
    expect(baseDeDatos.conciliaciones).toHaveLength(0);
    expect(baseDeDatos.pagos[0]).toMatchObject({ conciliado: false, conciliacionId: null });
    expect(baseDeDatos.pagosConsignados[0].conciliacionId).toBeNull();
  });
});
