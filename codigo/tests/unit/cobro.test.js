// HU-13 — registrar la incapacidad como cobrada (DS-06: registrarCobrada → guardarEstado(cobrada, tiempoPago)),
// con persistencia falsa. Decisiones: DA-38 (tiempo de pago en días + fecha de cobrada), EST-01 (solo desde transcrita).
import { beforeEach, describe, expect, it } from 'vitest';
import { fechaPrometida, leerTiempoPago, puedeRegistrarCobrada } from '../../src/controllers/cobro.controller.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { ErrorDeValidacion } from '../../src/controllers/error-de-validacion.js';
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
const cobrar = (tiempoPago = '30', id = '1') => control.registrarCobrada(id, { tiempoPago });

const errores = async (promesa) => {
  const error = await promesa.catch((e) => e);
  expect(error).toBeInstanceOf(ErrorDeValidacion);
  return error.errores;
};

describe('HU-13.CA1 — transcrita → cobrada, con su tiempo de pago', () => {
  it('HU-13.CA1 — cambia el estado a cobrada y guarda el tiempo de pago y la fecha de hoy', async () => {
    await radicar();
    expect(await cobrar('30')).toEqual({ idIncapacidad: 1 });
    expect(baseDeDatos.incapacidades[0]).toMatchObject({ estado: 'cobrada', tiempoPago: 30, fechaCobrada: '2026-11-21' });
  });

  it('HU-13.CA1 — acepta espacios alrededor y los extremos 1 y 365', async () => {
    await radicar();
    await cobrar(' 1 ');
    expect(baseDeDatos.incapacidades[0].tiempoPago).toBe(1);
    expect(leerTiempoPago('365')).toEqual({ valor: 365 });
  });

  it('HU-13.CA1 — prepararCobro muestra la fecha prometida (cobrada + días) y ya no ofrece registrar', async () => {
    await radicar();
    await cobrar('30');
    const datos = await control.prepararCobro('1');
    expect(datos.puedeRegistrarCobrada).toBe(false);
    expect(datos.fechaPrometida).toBe('2026-12-21');
  });

  it('DA-38 — la fecha prometida suma días calendario y cruza meses y años', () => {
    expect(fechaPrometida('2026-11-21', 45)).toBe('2027-01-05');
    expect(fechaPrometida('2028-02-28', 1)).toBe('2028-02-29');
  });
});

describe('HU-13 — validación del tiempo de pago (DA-38)', () => {
  it.each([
    ['', 'Escriba en cuántos días pagará la entidad.'],
    ['   ', 'Escriba en cuántos días pagará la entidad.'],
    ['treinta', 'Escriba un número entero de días.'],
    ['30.5', 'Escriba un número entero de días.'],
    ['-5', 'Escriba un número entero de días.'],
    ['1e2', 'Escriba un número entero de días.'],
    ['99999', 'Escriba un número entero de días.'],
    ['0', 'Escriba entre 1 y 365 días.'],
    ['366', 'Escriba entre 1 y 365 días.'],
  ])('«%s» → error y no cambia el estado', async (valor, mensaje) => {
    await radicar();
    expect(await errores(cobrar(valor))).toEqual({ tiempoPago: mensaje });
    expect(baseDeDatos.incapacidades[0]).toMatchObject({ estado: 'transcrita' });
    expect(baseDeDatos.incapacidades[0].tiempoPago).toBeUndefined();
  });

  it('sin datos (cuerpo vacío) → error de tiempo de pago', async () => {
    await radicar();
    expect(await errores(control.registrarCobrada('1', undefined))).toHaveProperty('tiempoPago');
  });
});

describe('HU-13 — solo desde «transcrita» (EST-01)', () => {
  it('transición inválida desde registrada (null) → error de estado', async () => {
    expect(await errores(cobrar())).toEqual({ estado: 'La incapacidad aún no se ha radicado: radíquela primero.' });
    expect(baseDeDatos.incapacidades[0].estado).toBeNull();
  });

  it('desde rechazada, cobrada o pagada → error de estado, aunque el tiempo no sea válido', async () => {
    for (const [estado, mensaje] of [
      ['rechazada', 'La entidad rechazó la incapacidad: registre una nueva radicación antes.'],
      ['cobrada', 'La incapacidad ya está registrada como cobrada.'],
      ['pagada', 'La incapacidad ya está pagada.'],
    ]) {
      baseDeDatos.incapacidades[0].estado = estado;
      expect(await errores(cobrar('x'))).toEqual({ estado: mensaje });
    }
  });

  it('dos registros a la vez: el segundo no pisa el primero', async () => {
    await radicar();
    const original = baseDeDatos.guardarCobrada;
    // Otro usuario la registra entre la consulta y el UPDATE.
    baseDeDatos.guardarCobrada = async (id, datos) => {
      await original(id, { tiempoPago: 60, fechaCobrada: '2026-11-21' });
      return original(id, datos);
    };
    expect(await errores(cobrar('30'))).toEqual({ estado: 'La incapacidad ya está registrada como cobrada.' });
    expect(baseDeDatos.incapacidades[0].tiempoPago).toBe(60);
  });

  it('puedeRegistrarCobrada solo es verdadero para transcrita', () => {
    expect([null, 'transcrita', 'cobrada', 'rechazada', 'pagada'].map(puedeRegistrarCobrada)).toEqual([false, true, false, false, false]);
  });
});

describe('HU-13 — incapacidad inexistente', () => {
  it.each(['999', 'abc', '-1', '1.5', ''])('«%s» → null', async (id) => {
    expect(await control.prepararCobro(id)).toBeNull();
    expect(await cobrar('30', id)).toBeNull();
  });
});
