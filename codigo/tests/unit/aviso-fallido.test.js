// Auditoría T-21 a T-24, Fase 1 (puntos 1 y 2): si el correo de aviso falla se deshace el registro; si el deshacer
// también falla, queda en el registro del servidor con su contexto y el error que sube conserva el del correo.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { ErrorDeAviso, avisarODeshacer, resumirError } from '../../src/controllers/error-de-aviso.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { formularioDeRegistro, PDF } from '../helpers/fabricas.js';
import { USUARIOS } from '../helpers/sesion-falsa.js';

const errorCorreo = new Error('SMTP caído');
const errorDeshacer = new Error('Supabase no responde');
let registro;

beforeEach(() => {
  registro = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => registro.mockRestore());

describe('avisarODeshacer', () => {
  it('si el aviso sale bien no deshace ni registra nada', async () => {
    const deshacer = vi.fn();
    await avisarODeshacer({ operacion: 'prueba', idIncapacidad: 7, avisar: async () => {}, deshacer });
    expect(deshacer).not.toHaveBeenCalled();
    expect(registro).not.toHaveBeenCalled();
  });

  it('si el correo falla deshace y lanza un ErrorDeAviso deshecho con el error del correo como causa', async () => {
    const deshacer = vi.fn(async () => {});
    const error = await avisarODeshacer({ operacion: 'prueba', idIncapacidad: 7, avisar: async () => { throw errorCorreo; }, deshacer }).catch((e) => e);
    expect(error).toBeInstanceOf(ErrorDeAviso);
    expect(error).toMatchObject({ operacion: 'prueba', idIncapacidad: 7, deshecho: true });
    expect(error.cause).toBe(errorCorreo);
    expect(deshacer).toHaveBeenCalledOnce();
  });

  it('si el correo y el deshacer fallan: queda en el registro con contexto y sube el error del correo', async () => {
    const error = await avisarODeshacer({
      operacion: 'registrarConcepto',
      idIncapacidad: 7,
      avisar: async () => { throw errorCorreo; },
      deshacer: async () => { throw errorDeshacer; },
    }).catch((e) => e);
    expect(error).toMatchObject({ name: 'ErrorDeAviso', deshecho: false });
    expect(error.cause).toBe(errorCorreo);
    expect(registro).toHaveBeenCalledWith(expect.stringContaining('[registrarConcepto]'), { idIncapacidad: 7, errorCorreo: resumirError(errorCorreo), errorDeshacer: resumirError(errorDeshacer) });
  });
});

describe('resumirError — el registro no lleva direcciones de correo', () => {
  it('oculta los correos del mensaje y no guarda el objeto con el sobre de nodemailer', () => {
    const error = Object.assign(new Error('Can\'t send mail - all recipients were rejected: 550 <ana.gomez@sigi.test>: no existe'), {
      code: 'EENVELOPE',
      rejected: ['ana.gomez@sigi.test'],
      envelope: { to: ['ana.gomez@sigi.test'] },
    });
    const resumen = resumirError(error);
    expect(resumen).toEqual({ nombre: 'Error', codigo: 'EENVELOPE', mensaje: expect.stringContaining('<correo>') });
    expect(JSON.stringify(resumen)).not.toContain('ana.gomez');
  });

  it('el aviso fallido registra el resumen, no el error crudo', async () => {
    const correoConDireccion = new Error('550 Recipient <ana.gomez@sigi.test> rejected');
    await avisarODeshacer({ operacion: 'prueba', idIncapacidad: 7, avisar: async () => { throw correoConDireccion; }, deshacer: async () => {} }).catch(() => {});
    expect(JSON.stringify(registro.mock.calls)).not.toContain('ana.gomez');
  });
});

describe('los controladores que avisan después de guardar', () => {
  let baseDeDatos;
  let control;

  const conFallos = (cambiosCorreo, cambiosBase = {}) =>
    crearControlIncapacidades({
      baseDeDatos: { ...baseDeDatos, ...cambiosBase },
      correo: { ...crearCorreoFalso().correo, ...cambiosCorreo },
      hoy: () => '2026-11-23',
    });
  const falla = async () => { throw errorCorreo; };
  const fallaDeshacer = async () => { throw errorDeshacer; };

  beforeEach(async () => {
    baseDeDatos = crearBaseDeDatosFalsa();
    control = crearControlIncapacidades({ baseDeDatos, correo: crearCorreoFalso().correo, hoy: () => '2026-11-23' });
    // 200 días desde el 1 de abril: ya pasó el día 181.
    await control.registrarIncapacidad(formularioDeRegistro({ diasIncapacidad: '200', fechaInicio: '2026-04-01', fechaRecepcion: '2026-04-02' }), USUARIOS.receptor);
  });

  it.each([
    ['registrarConcepto', 'comunicarConcepto', 'deshacerConcepto', (c) => c.registrarConcepto('1', { concepto: 'Concepto favorable de la entidad.' }, USUARIOS.auxiliar)],
    ['registrarFaltaConcepto', 'avisarFaltaConcepto', 'deshacerFaltaConcepto', (c) => c.registrarFaltaConcepto('1', USUARIOS.auxiliar)],
    ['registrarSuspensionPago', 'notificarSuspensionPago', 'deshacerSuspensionPago', (c) => c.registrarSuspensionPago('1', USUARIOS.auxiliar)],
  ])('%s: si el correo y el deshacer fallan, se registra y sube el error del correo', async (operacion, aviso, deshacer, ejecutar) => {
    const error = await ejecutar(conFallos({ [aviso]: falla }, { [deshacer]: fallaDeshacer })).catch((e) => e);
    expect(error).toMatchObject({ name: 'ErrorDeAviso', deshecho: false, operacion, idIncapacidad: 1 });
    expect(error.cause).toBe(errorCorreo);
    expect(registro).toHaveBeenCalledWith(expect.stringContaining(`[${operacion}]`), expect.objectContaining({ idIncapacidad: 1, errorCorreo: resumirError(errorCorreo), errorDeshacer: resumirError(errorDeshacer) }));
  });

  it('trasladarACartera: si el correo y el deshacer fallan, se registra y sube el error del correo', async () => {
    let hoy = '2026-11-21';
    const correo = { ...crearCorreoFalso().correo, notificarTraslado: falla };
    const base = crearBaseDeDatosFalsa();
    const c = crearControlIncapacidades({ baseDeDatos: { ...base, deshacerTraslado: fallaDeshacer }, correo, hoy: () => hoy });
    await c.registrarIncapacidad(formularioDeRegistro({ entidad: '2' }), USUARIOS.receptor);
    await c.registrarRadicacion('1', { radicado: 'NEPS-1', evidencia: PDF }, USUARIOS.auxiliar);
    await c.registrarCobrada('1', { tiempoPago: '10' });
    hoy = '2026-12-04';
    const error = await c.trasladarACartera('1', { motivo: '180 días sin pago' }).catch((e) => e);
    expect(error).toMatchObject({ name: 'ErrorDeAviso', deshecho: false, operacion: 'trasladarACartera' });
    expect(error.cause).toBe(errorCorreo);
    expect(registro).toHaveBeenCalledWith(expect.stringContaining('[trasladarACartera]'), expect.objectContaining({ errorDeshacer: resumirError(errorDeshacer) }));
  });
});
