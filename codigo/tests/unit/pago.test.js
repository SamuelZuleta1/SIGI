// HU-15 — registrar el pago (DS-06/07/08: registrarPago → actualizarEstado(pagada) → guardarPago(valor, fechaPago)),
// con persistencia falsa. Decisiones: DA-08 (cualquier pago deja pagada; varios pagos), DA-16 (fecha escrita por el
// auxiliar), DA-40 (formato del valor, límites de la fecha y estados de origen).
import { beforeEach, describe, expect, it } from 'vitest';
import { leerFechaPago, leerValor, puedeRegistrarPago } from '../../src/controllers/cobro.controller.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { ErrorDeValidacion } from '../../src/controllers/error-de-validacion.js';
import { aCentavos, centavosATexto, pesos } from '../../src/servicios/moneda.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { formularioDeRegistro, PDF } from '../helpers/fabricas.js';
import { USUARIOS } from '../helpers/sesion-falsa.js';

let baseDeDatos;
let control;

beforeEach(async () => {
  baseDeDatos = crearBaseDeDatosFalsa();
  control = crearControlIncapacidades({ baseDeDatos, correo: crearCorreoFalso().correo, hoy: () => '2026-11-21' });
  await control.registrarIncapacidad(formularioDeRegistro(), USUARIOS.receptor);
});

const radicar = () => control.registrarRadicacion('1', { radicado: 'RAD-1', evidencia: PDF }, USUARIOS.auxiliar);
const cobrar = async () => {
  await radicar();
  await control.registrarCobrada('1', { tiempoPago: '30' });
};
const pagar = (valor = '1.250.000', fechaPago = '2026-11-20', id = '1') =>
  control.registrarPago(id, { valor, fechaPago }, USUARIOS.auxiliar);

const errores = async (promesa) => {
  const error = await promesa.catch((e) => e);
  expect(error).toBeInstanceOf(ErrorDeValidacion);
  return error.errores;
};

describe('HU-15.CA1 — cobrada → pagada, con el valor y la fecha', () => {
  it('HU-15.CA1 — guarda el pago con quien lo registra y cambia el estado a pagada', async () => {
    await cobrar();
    expect(await pagar('1.250.000', '2026-11-20')).toEqual({ idIncapacidad: 1, idPago: 1 });
    expect(baseDeDatos.incapacidades[0].estado).toBe('pagada');
    expect(baseDeDatos.pagos).toEqual([
      { idPago: 1, idIncapacidad: 1, valor: '1250000.00', fechaPago: '2026-11-20', conciliado: false, creadoPor: 'id-auxiliar' },
    ]);
  });

  it('HU-15.CA1 — prepararCobro muestra los pagos y el total', async () => {
    await cobrar();
    await pagar('1.250.000,50');
    const datos = await control.prepararCobro('1');
    expect(datos.incapacidad.pagos).toEqual([{ idPago: 1, valor: '1250000.50', fechaPago: '2026-11-20' }]);
    expect(datos.totalPagado).toBe('1250000.50');
    expect(datos.puedeRegistrarPago).toBe(true);
  });
});

describe('HU-15.CA3 — una incapacidad puede tener varios pagos (DA-08)', () => {
  it('HU-15.CA3 — un segundo pago sobre una pagada se guarda y la deja pagada', async () => {
    await cobrar();
    await pagar('800.000', '2026-11-10');
    expect(await pagar('450.000', '2026-11-21')).toEqual({ idIncapacidad: 1, idPago: 2 });
    expect(baseDeDatos.pagos).toHaveLength(2);
    expect(baseDeDatos.incapacidades[0].estado).toBe('pagada');
    expect((await control.prepararCobro('1')).totalPagado).toBe('1250000.00');
  });
});

describe('HU-15 — estados de origen (EST-01, DA-08, DA-40)', () => {
  it('HU-15 — solo cobrada o pagada admiten un pago', () => {
    expect(['cobrada', 'pagada'].every(puedeRegistrarPago)).toBe(true);
    expect([null, 'transcrita', 'rechazada'].some(puedeRegistrarPago)).toBe(false);
  });

  it('HU-15 — registrada (sin radicar): error de estado y no guarda nada', async () => {
    expect(await errores(pagar())).toEqual({ estado: 'La incapacidad aún no se ha radicado: radíquela primero.' });
    expect(baseDeDatos.pagos).toHaveLength(0);
  });

  it('HU-15 — transcrita: pide registrarla como cobrada primero', async () => {
    await radicar();
    expect((await errores(pagar())).estado).toMatch(/regístrela como cobrada/);
    expect(baseDeDatos.incapacidades[0].estado).toBe('transcrita');
  });

  it('HU-15 — rechazada: no admite pago', async () => {
    await radicar();
    await control.registrarRechazo('1', { causal: 'Falta la epicrisis' });
    expect((await errores(pagar())).estado).toMatch(/rechazó/);
    expect(baseDeDatos.pagos).toHaveLength(0);
  });

  it('HU-15 — el estado se revisa antes que los datos', async () => {
    expect(Object.keys(await errores(pagar('', '')))).toEqual(['estado']);
  });

  it('HU-15 — si otro usuario cambió el estado a la vez, la transacción no guarda y se informa', async () => {
    await cobrar();
    // Entre la consulta y el registro, la incapacidad deja de estar cobrada (como haría la condición de registrar_pago).
    baseDeDatos.guardarPago = async (id) => {
      baseDeDatos.incapacidades[id - 1].estado = 'transcrita';
      return null;
    };
    expect((await errores(pagar())).estado).toMatch(/regístrela como cobrada/);
    expect(baseDeDatos.pagos).toHaveLength(0);
  });

  it('no existe o id no válido → null', async () => {
    expect(await pagar('1.000', '2026-11-20', '99')).toBeNull();
    expect(await pagar('1.000', '2026-11-20', 'abc')).toBeNull();
  });
});

describe('DA-40 — valor del pago en pesos', () => {
  it.each([
    ['1250000', '1250000.00'],
    ['1.250.000', '1250000.00'],
    ['$ 1.250.000', '1250000.00'],
    ['1.250.000,5', '1250000.50'],
    ['1250000,75', '1250000.75'],
    [' 999.999.999.999,99 ', '999999999999.99'],
    ['0,01', '0.01'],
    ['007', '7.00'],
  ])('acepta «%s» → %s', (texto, valor) => {
    expect(leerValor(texto).valor).toBe(valor);
  });

  it.each([
    ['', 'Escriba el valor que pagó la entidad.'],
    ['   ', 'Escriba el valor que pagó la entidad.'],
    ['abc', 'Escriba el valor en pesos, por ejemplo 1.250.000 o 1.250.000,50.'],
    ['1250000.50', 'Escriba el valor en pesos, por ejemplo 1.250.000 o 1.250.000,50.'],
    ['1.25.000', 'Escriba el valor en pesos, por ejemplo 1.250.000 o 1.250.000,50.'],
    ['1,234', 'Escriba el valor en pesos, por ejemplo 1.250.000 o 1.250.000,50.'],
    ['-5000', 'Escriba el valor en pesos, por ejemplo 1.250.000 o 1.250.000,50.'],
    ['1e6', 'Escriba el valor en pesos, por ejemplo 1.250.000 o 1.250.000,50.'],
    ['0', 'El valor debe ser mayor que cero.'],
    ['0,00', 'El valor debe ser mayor que cero.'],
    ['1.000.000.000.000', 'El valor es demasiado grande.'],
  ])('rechaza «%s»', (texto, mensaje) => {
    expect(leerValor(texto).error).toBe(mensaje);
  });

  it('valor no texto → error, no excepción', () => {
    expect(leerValor(undefined).error).toBeDefined();
    expect(leerValor(['1000']).error).toBeDefined();
  });

  it('moneda: centavos exactos y formato colombiano', () => {
    expect(centavosATexto(123456750)).toBe('1234567.50');
    expect(centavosATexto(5)).toBe('0.05');
    expect(aCentavos('1234567.50')).toBe(123456750);
    expect(aCentavos(0.1) + aCentavos(0.2)).toBe(30);
    expect(pesos('1250000.00')).toBe('$ 1.250.000');
    expect(pesos('1250000.50')).toBe('$ 1.250.000,50');
  });
});

describe('DA-16 / DA-40 — fecha del pago escrita por el auxiliar', () => {
  const limites = { hoy: '2026-11-21', fechaInicio: '2026-11-03' };

  it('acepta hoy, el inicio y fechas intermedias', () => {
    expect(leerFechaPago('2026-11-21', limites)).toEqual({ valor: '2026-11-21' });
    expect(leerFechaPago('2026-11-03', limites)).toEqual({ valor: '2026-11-03' });
  });

  it.each([
    ['', 'Escriba la fecha en que la entidad pagó.'],
    ['21/11/2026', 'Escriba una fecha válida (día, mes y año).'],
    ['2026-02-30', 'Escriba una fecha válida (día, mes y año).'],
    ['0000-01-01', 'Escriba una fecha válida (día, mes y año).'],
    ['2026-11-22', 'La fecha del pago no puede ser posterior a hoy.'],
    ['2026-11-02', 'La fecha del pago no puede ser anterior al inicio de la incapacidad (3 nov 2026).'],
  ])('rechaza «%s»', (texto, mensaje) => {
    expect(leerFechaPago(texto, limites).error).toBe(mensaje);
  });

  it('HU-15 — informa los errores del valor y de la fecha a la vez', async () => {
    await cobrar();
    expect(await errores(pagar('abc', '2030-01-01'))).toEqual({
      valor: 'Escriba el valor en pesos, por ejemplo 1.250.000 o 1.250.000,50.',
      fechaPago: 'La fecha del pago no puede ser posterior a hoy.',
    });
    expect(baseDeDatos.pagos).toHaveLength(0);
    expect(baseDeDatos.incapacidades[0].estado).toBe('cobrada');
  });
});
