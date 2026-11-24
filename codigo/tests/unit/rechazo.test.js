// HU-14 — registrar el rechazo de la incapacidad (DS-06: registrarRechazo → actualizarEstado(rechazada)
// → guardarRechazo(causal)), con persistencia falsa. Decisiones: DA-39 (causal de 3 a 500 caracteres, solo la
// última), EST-01 (solo desde transcrita), DA-01/DA-36 (tras el rechazo, una nueva radicación vuelve a transcrita).
import { beforeEach, describe, expect, it } from 'vitest';
import { leerCausal, puedeRegistrarRechazo } from '../../src/controllers/cobro.controller.js';
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

const radicar = (radicado = 'RAD-1') => control.registrarRadicacion('1', { radicado, evidencia: PDF }, USUARIOS.auxiliar);
const rechazar = (causal = 'Soporte de historia clínica ilegible', id = '1') => control.registrarRechazo(id, { causal });

const errores = async (promesa) => {
  const error = await promesa.catch((e) => e);
  expect(error).toBeInstanceOf(ErrorDeValidacion);
  return error.errores;
};

describe('HU-14.CA1 — transcrita → rechazada, con su causal', () => {
  it('HU-14.CA1 — cambia el estado a rechazada y guarda la causal', async () => {
    await radicar();
    expect(await rechazar()).toEqual({ idIncapacidad: 1 });
    expect(baseDeDatos.incapacidades[0]).toMatchObject({
      estado: 'rechazada',
      causalRechazo: 'Soporte de historia clínica ilegible',
      fechaRechazo: '2026-11-21',
    });
  });

  it('HU-14.CA1 — guarda la causal sin los espacios de los extremos y conserva los saltos de línea', async () => {
    await radicar();
    await rechazar('  Falta la epicrisis.\nFirma ilegible.  ');
    expect(baseDeDatos.incapacidades[0].causalRechazo).toBe('Falta la epicrisis.\nFirma ilegible.');
  });

  it('HU-14.CA1 — prepararCobro muestra la causal (mostrarCausal) y ya no ofrece responder', async () => {
    await radicar();
    await rechazar();
    const datos = await control.prepararCobro('1');
    expect(datos.incapacidad.causalRechazo).toBe('Soporte de historia clínica ilegible');
    expect(datos.puedeRegistrarRechazo).toBe(false);
    expect(datos.puedeRegistrarCobrada).toBe(false);
  });

  it('HU-14.CA2 — tras el rechazo se radica de nuevo (HU-10) y vuelve a transcrita; la causal se conserva', async () => {
    await radicar('RAD-1');
    await rechazar();
    await radicar('RAD-2');
    const datos = await control.prepararCobro('1');
    expect(datos.incapacidad.estado).toBe('transcrita');
    expect(datos.incapacidad.radicaciones.map((r) => r.radicado)).toEqual(['RAD-1', 'RAD-2']);
    expect(datos.incapacidad.causalRechazo).toBe('Soporte de historia clínica ilegible');
    expect(datos.puedeRegistrarRechazo).toBe(true);
  });

  it('DA-39 — un segundo rechazo reemplaza la causal: se guarda la del último', async () => {
    await radicar('RAD-1');
    await rechazar('Primera causal');
    await radicar('RAD-2');
    await rechazar('Segunda causal');
    expect(baseDeDatos.incapacidades[0]).toMatchObject({ estado: 'rechazada', causalRechazo: 'Segunda causal' });
  });
});

describe('HU-14 — validación de la causal (DA-39)', () => {
  it.each([
    ['', 'Escriba la causal que informó la entidad.'],
    ['   \n ', 'Escriba la causal que informó la entidad.'],
    ['ab', 'Escriba la causal con al menos 3 caracteres.'],
    ['x'.repeat(501), 'La causal admite hasta 500 caracteres.'],
    ['Firma\u0000ilegible', 'La causal tiene caracteres no válidos.'],
    ['Firma\u001bilegible', 'La causal tiene caracteres no válidos.'],
  ])('«%s» → error y no cambia el estado', async (valor, mensaje) => {
    await radicar();
    expect(await errores(rechazar(valor))).toEqual({ causal: mensaje });
    expect(baseDeDatos.incapacidades[0].estado).toBe('transcrita');
    expect(baseDeDatos.incapacidades[0].causalRechazo).toBeUndefined();
  });

  it('acepta los extremos 3 y 500 caracteres; cuenta caracteres, no unidades UTF-16', () => {
    expect(leerCausal('abc')).toEqual({ valor: 'abc' });
    expect(leerCausal('x'.repeat(500)).valor).toHaveLength(500);
    expect(leerCausal('😀'.repeat(500)).error).toBeUndefined();
    expect(leerCausal('ñ😀')).toHaveProperty('error');
    expect(leerCausal('Línea 1\r\n\tLínea 2')).toEqual({ valor: 'Línea 1\r\n\tLínea 2' });
  });

  it('sin datos (cuerpo vacío) → error de causal', async () => {
    await radicar();
    expect(await errores(control.registrarRechazo('1', undefined))).toHaveProperty('causal');
  });
});

describe('HU-14 — solo desde «transcrita» (EST-01)', () => {
  it('transición inválida desde registrada (null) → error de estado', async () => {
    expect(await errores(rechazar())).toEqual({ estado: 'La incapacidad aún no se ha radicado: radíquela primero.' });
    expect(baseDeDatos.incapacidades[0].estado).toBeNull();
  });

  it('desde rechazada, cobrada o pagada → error de estado, aunque la causal no sea válida', async () => {
    for (const [estado, mensaje] of [
      ['rechazada', 'La incapacidad ya está rechazada: registre la nueva radicación.'],
      ['cobrada', 'La entidad ya aprobó la incapacidad: está registrada como cobrada.'],
      ['pagada', 'La incapacidad ya está pagada.'],
    ]) {
      baseDeDatos.incapacidades[0].estado = estado;
      expect(await errores(rechazar(''))).toEqual({ estado: mensaje });
    }
  });

  it('una cobrada no se puede rechazar después', async () => {
    await radicar();
    await control.registrarCobrada('1', { tiempoPago: '30' });
    expect(await errores(rechazar())).toHaveProperty('estado');
    expect(baseDeDatos.incapacidades[0]).toMatchObject({ estado: 'cobrada', tiempoPago: 30 });
  });

  it('respuesta simultánea: si otro la registra como cobrada antes, el rechazo no la pisa', async () => {
    await radicar();
    const original = baseDeDatos.guardarRechazo;
    baseDeDatos.guardarRechazo = async (id, datos) => {
      await baseDeDatos.guardarCobrada(id, { tiempoPago: 30, fechaCobrada: '2026-11-21' });
      return original(id, datos);
    };
    expect(await errores(rechazar())).toEqual({ estado: 'La entidad ya aprobó la incapacidad: está registrada como cobrada.' });
    expect(baseDeDatos.incapacidades[0]).toMatchObject({ estado: 'cobrada' });
    expect(baseDeDatos.incapacidades[0].causalRechazo).toBeUndefined();
  });

  it('dos rechazos a la vez: el segundo no pisa la causal del primero', async () => {
    await radicar();
    const original = baseDeDatos.guardarRechazo;
    baseDeDatos.guardarRechazo = async (id, datos) => {
      await original(id, { causal: 'La del otro usuario' });
      return original(id, datos);
    };
    expect(await errores(rechazar())).toEqual({ estado: 'La incapacidad ya está rechazada: registre la nueva radicación.' });
    expect(baseDeDatos.incapacidades[0].causalRechazo).toBe('La del otro usuario');
  });

  it('puedeRegistrarRechazo solo es verdadero para transcrita', () => {
    expect([null, 'transcrita', 'cobrada', 'rechazada', 'pagada'].map(puedeRegistrarRechazo)).toEqual([false, true, false, false, false]);
  });
});

describe('HU-14 — incapacidad inexistente', () => {
  it.each(['999', 'abc', '-1', '1.5', ''])('«%s» → null', async (id) => {
    expect(await rechazar('Causal', id)).toBeNull();
  });
});
