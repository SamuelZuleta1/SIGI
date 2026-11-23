// HU-25 — registrar los pagos consignados (DS-11, CU-15), Control con persistencia y correo falsos (DA-55).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { FILAS_MAXIMAS, leerFilas, validarLista } from '../../src/controllers/conciliacion.controller.js';
import { ErrorDeAviso } from '../../src/controllers/error-de-aviso.js';
import { ErrorDeValidacion } from '../../src/controllers/error-de-validacion.js';
import { crearBaseDeDatosFalsa, ENTIDADES } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso, DESTINATARIOS } from '../helpers/correo-falso.js';
import { USUARIOS } from '../helpers/sesion-falsa.js';

let baseDeDatos;
let correo;
let enviados;
let control;

const lista = (extra = {}) => ({
  entidad: '2',
  colaborador: ['Ana Gómez', 'Luis Pérez'],
  dias: ['10', '3'],
  valor: ['1.250.000', '420.000,50'],
  ...extra,
});

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

describe('HU-25 — registrar los pagos consignados', () => {
  it('HU-25.CA1 — guarda la lista con entidad, colaborador, días pagados y valor', async () => {
    const resultado = await control.registrarPagosConsignados(lista(), USUARIOS.contabilidad);
    expect(resultado).toEqual({ entidad: ENTIDADES[1], cantidad: 2, total: 167_000_050 });
    expect(baseDeDatos.pagosConsignados).toMatchObject([
      { entidadId: 2, colaborador: 'Ana Gómez', diasPagados: 10, valor: '1250000.00', creadoPor: 'id-contabilidad' },
      { entidadId: 2, colaborador: 'Luis Pérez', diasPagados: 3, valor: '420000.50', creadoPor: 'id-contabilidad' },
    ]);
  });

  it('HU-25.CA1 — avisa por correo al auxiliar que hay pagos por identificar', async () => {
    await control.registrarPagosConsignados(lista(), USUARIOS.contabilidad);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].to).toBe(DESTINATARIOS.auxiliar);
    expect(enviados[0].subject).toBe('[SIGI] Pagos por identificar — Nueva EPS');
    expect(enviados[0].text).toContain('registró 2 pago(s) consignado(s) de Nueva EPS');
    expect(enviados[0].attachments ?? []).toHaveLength(0);
  });

  it('HU-25.CA1 — una sola fila llega como texto y también se guarda', async () => {
    const resultado = await control.registrarPagosConsignados(
      { entidad: '1', colaborador: '  Marta   Ríos ', dias: '5', valor: '800000' },
      USUARIOS.contabilidad,
    );
    expect(resultado.cantidad).toBe(1);
    expect(baseDeDatos.pagosConsignados[0]).toMatchObject({ entidadId: 1, colaborador: 'Marta Ríos', valor: '800000.00' });
  });

  it('las filas vacías se ignoran', async () => {
    const resultado = await control.registrarPagosConsignados(
      lista({ colaborador: ['Ana Gómez', '', ''], dias: ['10', ' ', ''], valor: ['1.250.000', '', ''] }),
      USUARIOS.contabilidad,
    );
    expect(resultado.cantidad).toBe(1);
  });

  it('sin entidad o con una entidad que no está en la lista: no guarda', async () => {
    expect((await fallaValidacion(control.registrarPagosConsignados(lista({ entidad: '' }), USUARIOS.contabilidad))).entidad).toBeDefined();
    expect((await fallaValidacion(control.registrarPagosConsignados(lista({ entidad: '99' }), USUARIOS.contabilidad))).entidad).toBeDefined();
    expect(baseDeDatos.pagosConsignados).toHaveLength(0);
    expect(enviados).toHaveLength(0);
  });

  it('una lista sin ningún pago no se guarda', async () => {
    const errores = await fallaValidacion(
      control.registrarPagosConsignados({ entidad: '2', colaborador: ['', ''], dias: ['', ''], valor: ['', ''] }, USUARIOS.contabilidad),
    );
    expect(errores.lista).toBe('Escriba al menos un pago: colaborador, días pagados y valor.');
  });

  it('una fila con un error no deja guardar ninguna (la lista se guarda completa o no se guarda)', async () => {
    const errores = await fallaValidacion(
      control.registrarPagosConsignados(lista({ dias: ['10', 'tres'], valor: ['1.250.000', ''] }), USUARIOS.contabilidad),
    );
    expect(errores).toMatchObject({
      'fila-1-dias': 'Escriba un número entero de días.',
      'fila-1-valor': 'Escriba el valor consignado.',
      lista: 'Revise las filas marcadas: no se guardó ningún pago.',
    });
    expect(errores['fila-0-dias']).toBeUndefined();
    expect(baseDeDatos.pagosConsignados).toHaveLength(0);
    expect(enviados).toHaveLength(0);
  });

  it.each([
    ['colaborador', ['Al'], 'Escriba el nombre completo (3 caracteres o más).'],
    ['colaborador', ['Ana\u0007Gómez'], 'El nombre tiene caracteres no válidos.'],
    ['colaborador', ['x'.repeat(201)], 'El nombre es demasiado largo.'],
    ['dias', ['0'], 'Los días pagados deben ser 1 o más.'],
    ['dias', ['2,5'], 'Escriba un número entero de días.'],
    ['valor', ['0'], 'El valor debe ser mayor que cero.'],
    ['valor', ['1,250,000'], 'Escriba el valor en pesos, por ejemplo 1.250.000 o 1.250.000,50.'],
    ['valor', ['9'.repeat(13)], 'El valor es demasiado grande.'],
  ])('valida %s: %j', async (campo, valor, mensaje) => {
    const datos = { entidad: '2', colaborador: ['Ana Gómez'], dias: ['10'], valor: ['1.000'], [campo]: valor };
    const errores = await fallaValidacion(control.registrarPagosConsignados(datos, USUARIOS.contabilidad));
    expect(errores[`fila-0-${campo}`]).toBe(mensaje);
  });

  it(`lee como máximo ${FILAS_MAXIMAS} filas`, () => {
    const muchas = Array.from({ length: FILAS_MAXIMAS + 20 }, () => 'x');
    expect(leerFilas({ colaborador: muchas })).toHaveLength(FILAS_MAXIMAS);
  });

  it(`más de ${FILAS_MAXIMAS} filas: no guarda ninguna (no se pierde una parte en silencio)`, async () => {
    const n = FILAS_MAXIMAS + 1;
    const datos = { entidad: '2', colaborador: Array(n).fill('Ana Gómez'), dias: Array(n).fill('3'), valor: Array(n).fill('1.000') };
    const errores = await fallaValidacion(control.registrarPagosConsignados(datos, USUARIOS.contabilidad));
    expect(errores.lista).toBe(`Registre como máximo ${FILAS_MAXIMAS} pagos por lista: divídala en varias.`);
    expect(baseDeDatos.pagosConsignados).toHaveLength(0);
  });

  it('un valor que no es texto (objeto o número) cuenta como vacío', () => {
    const { errores } = validarLista({ entidad: '2', colaborador: [{ a: 1 }], dias: [10], valor: ['1.000'] }, ENTIDADES);
    expect(errores['fila-0-colaborador']).toBe('Escriba el nombre del colaborador.');
    expect(errores['fila-0-dias']).toBe('Escriba los días pagados.');
  });

  it('si el correo al auxiliar falla, borra la lista y avisa que no se guardó (se puede reintentar)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    correo.notificarPagosPorIdentificar = async () => { throw new Error('SMTP caído'); };
    const error = await control.registrarPagosConsignados(lista(), USUARIOS.contabilidad).catch((e) => e);
    expect(error).toBeInstanceOf(ErrorDeAviso);
    expect(error.deshecho).toBe(true);
    expect(error.message).toContain('2 pago(s) consignado(s) de Nueva EPS');
    expect(baseDeDatos.pagosConsignados).toHaveLength(0);
  });

  it('si el correo falla y no se puede borrar, lo dice (deshecho = false)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    correo.notificarPagosPorIdentificar = async () => { throw new Error('SMTP caído'); };
    baseDeDatos.eliminarPagosConsignados = async () => { throw new Error('sin conexión'); };
    const error = await control.registrarPagosConsignados(lista(), USUARIOS.contabilidad).catch((e) => e);
    expect(error).toBeInstanceOf(ErrorDeAviso);
    expect(error.deshecho).toBe(false);
  });
});

describe('HU-25 — pantalla de pagos consignados (apoyo de la Vista)', () => {
  it('ofrece las entidades y los pagos registrados más recientes primero', async () => {
    await control.registrarPagosConsignados(lista(), USUARIOS.contabilidad);
    const { entidades, recientes, confirmacion } = await control.prepararPagosConsignados();
    expect(entidades).toHaveLength(ENTIDADES.length);
    expect(recientes.map((p) => p.colaborador)).toEqual(['Luis Pérez', 'Ana Gómez']);
    expect(confirmacion).toBeNull();
  });

  it('confirma solo si lo más reciente es esa cantidad de pagos de esa entidad', async () => {
    await control.registrarPagosConsignados(lista(), USUARIOS.contabilidad);
    expect((await control.prepararPagosConsignados({ cantidad: '2', entidad: '2' })).confirmacion).toEqual({
      entidad: 'Nueva EPS',
      cantidad: 2,
      total: 167_000_050,
    });
    expect((await control.prepararPagosConsignados({ cantidad: '2', entidad: '3' })).confirmacion).toBeNull();
    expect((await control.prepararPagosConsignados({ cantidad: '5', entidad: '2' })).confirmacion).toBeNull();
    expect((await control.prepararPagosConsignados({ cantidad: 'x', entidad: '2' })).confirmacion).toBeNull();
  });

  it('HU-25 solo consulta al preparar la pantalla: no guarda ni avisa', async () => {
    await control.prepararPagosConsignados({ cantidad: '1', entidad: '2' });
    expect(baseDeDatos.pagosConsignados).toHaveLength(0);
    expect(enviados).toHaveLength(0);
  });
});
