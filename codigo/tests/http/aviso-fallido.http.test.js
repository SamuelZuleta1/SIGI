// Auditoría T-21 a T-24, Fase 1 (punto 2): si el correo falla y se deshizo, la ruta vuelve al formulario con 502,
// conserva lo escrito y dice que no se guardó nada; si el deshacer también falló, 500 con un mensaje propio.
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crearApp } from '../../src/app.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { formularioDeRegistro, PDF } from '../helpers/fabricas.js';
import { agenteCon, crearSesionFalsa, USUARIOS } from '../helpers/sesion-falsa.js';

const CONCEPTO = 'Concepto favorable de rehabilitación, pronóstico de recuperación en seis meses.';
const falla = async () => { throw new Error('SMTP caído'); };
const fallaDeshacer = async () => { throw new Error('Supabase no responde'); };
let registro;

beforeEach(() => {
  registro = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => registro.mockRestore());

/** App con una prolongada de 200 días que ya pasó el día 181, y el correo (y el deshacer) que se pidan. */
async function appProlongada({ correo: cambiosCorreo = {}, base: cambiosBase = {} } = {}) {
  const baseDeDatos = crearBaseDeDatosFalsa();
  const hoy = () => '2026-11-23';
  const preparar = crearControlIncapacidades({ baseDeDatos, correo: crearCorreoFalso().correo, hoy });
  await preparar.registrarIncapacidad(formularioDeRegistro({ diasIncapacidad: '200', fechaInicio: '2026-04-01', fechaRecepcion: '2026-04-02' }), USUARIOS.receptor);
  const control = crearControlIncapacidades({
    baseDeDatos: { ...baseDeDatos, ...cambiosBase },
    correo: { ...crearCorreoFalso().correo, ...cambiosCorreo },
    hoy,
  });
  return { baseDeDatos, app: crearApp({ sesion: crearSesionFalsa(), control }) };
}

describe('el correo al colaborador falla y el registro se deshace: 502', () => {
  it('concepto: vuelve al formulario con lo escrito y el mensaje arriba; no queda guardado', async () => {
    const { app, baseDeDatos } = await appProlongada({ correo: { comunicarConcepto: falla } });
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.post('/incapacidades/1/concepto').type('form').send({ concepto: CONCEPTO });
    expect(res.status).toBe(502);
    expect(res.text).toContain('No se pudo avisar al colaborador; no se guardó nada. Intente de nuevo.');
    expect(res.text).toContain(CONCEPTO);
    expect(res.text).toContain('name="concepto"');
    expect(baseDeDatos.incapacidades[0].concepto).toBeNull();
  });

  it.each([
    ['falta del concepto', '/incapacidades/1/falta-concepto', { avisarFaltaConcepto: falla }],
    ['suspensión del pago', '/incapacidades/1/suspension-pago', { notificarSuspensionPago: falla }],
  ])('%s: 502 con el mensaje', async (_, ruta, correo) => {
    const { app } = await appProlongada({ correo });
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.post(ruta).type('form').send({});
    expect(res.status).toBe(502);
    expect(res.text).toContain('No se pudo avisar al colaborador; no se guardó nada. Intente de nuevo.');
  });
});

describe('el correo falla y el deshacer también: 500 con mensaje propio', () => {
  it('concepto: dice que pudo quedar guardado sin aviso', async () => {
    const { app } = await appProlongada({ correo: { comunicarConcepto: falla }, base: { deshacerConcepto: fallaDeshacer } });
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.post('/incapacidades/1/concepto').type('form').send({ concepto: CONCEPTO });
    expect(res.status).toBe(500);
    expect(res.text).toContain('pudo quedar guardado sin aviso');
    expect(res.text).toContain('n.º 1');
    expect(res.text).not.toContain('Ocurrió un error inesperado');
  });
});

describe('HU-19 — el correo a Cartera y Jurídica falla', () => {
  async function appTraslado(cambiosBase = {}) {
    let hoy = '2026-11-21';
    const baseDeDatos = crearBaseDeDatosFalsa();
    const preparar = crearControlIncapacidades({ baseDeDatos, correo: crearCorreoFalso().correo, hoy: () => hoy });
    await preparar.registrarIncapacidad(formularioDeRegistro({ entidad: '2' }), USUARIOS.receptor);
    await preparar.registrarRadicacion('1', { radicado: 'NEPS-1', evidencia: PDF }, USUARIOS.auxiliar);
    await preparar.registrarCobrada('1', { tiempoPago: '10' });
    hoy = '2026-12-04';
    // Auditoría (4A): el traslado exige 2 requerimientos.
    for (const n of [1, 2]) await preparar.registrarRequerimiento('1', { fundamentos: `Requerimiento número ${n} de cobro.` }, USUARIOS.auxiliar);
    const control = crearControlIncapacidades({
      baseDeDatos: { ...baseDeDatos, ...cambiosBase },
      correo: { ...crearCorreoFalso().correo, notificarTraslado: falla },
      hoy: () => hoy,
    });
    return { baseDeDatos, app: crearApp({ sesion: crearSesionFalsa(), control }) };
  }

  it('se deshizo: 502, conserva el motivo y no queda trasladada', async () => {
    const { app, baseDeDatos } = await appTraslado();
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.post('/incapacidades/1/traslado').type('form').send({ causal: 'deterioro', motivo: 'Deterioro crediticio de la entidad' });
    expect(res.status).toBe(502);
    expect(res.text).toContain('No se pudo avisar a Cartera y Jurídica; no se guardó nada. Intente de nuevo.');
    expect(res.text).toContain('Deterioro crediticio de la entidad');
    expect(baseDeDatos.incapacidades[0].motivoTraslado).toBeNull();
  });

  it('no se pudo deshacer: 500 con el mensaje propio', async () => {
    const { app } = await appTraslado({ deshacerTraslado: fallaDeshacer });
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.post('/incapacidades/1/traslado').type('form').send({ causal: 'deterioro', motivo: 'Deterioro crediticio de la entidad' });
    expect(res.status).toBe(500);
    expect(res.text).toContain('El correo a Cartera y Jurídica falló y no se pudo deshacer el registro');
  });
});
