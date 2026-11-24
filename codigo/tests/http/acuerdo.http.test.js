// HU-17 — aviso de retraso y acuerdo de pago (DS-07), rutas con sesión, persistencia y correo falsos (DA-42).
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso, DESTINATARIOS } from '../helpers/correo-falso.js';
import { formularioDeRegistro, PDF } from '../helpers/fabricas.js';
import { agenteCon, crearSesionFalsa, USUARIOS } from '../helpers/sesion-falsa.js';

let app;
let baseDeDatos;
let enviados;
let hoy;

beforeEach(async () => {
  hoy = '2026-11-21';
  baseDeDatos = crearBaseDeDatosFalsa();
  const correoFalso = crearCorreoFalso();
  enviados = correoFalso.enviados;
  const control = crearControlIncapacidades({ baseDeDatos, correo: correoFalso.correo, hoy: () => hoy });
  app = crearApp({ sesion: crearSesionFalsa(), control });
  await control.registrarIncapacidad(formularioDeRegistro({ entidad: '2' }), USUARIOS.receptor);
  await control.registrarRadicacion('1', { radicado: 'NEPS-1', evidencia: PDF }, USUARIOS.auxiliar);
  await control.registrarCobrada('1', { tiempoPago: '10' }); // prometida: 2026-12-01
});

const acordar = (agente, datos = {}) =>
  agente.post('/incapacidades/1/acuerdo').type('form').send({ fecha: '2026-12-15', valor: '1.250.000', ...datos });

describe('HU-17 — aviso de retraso y acuerdo de pago (rutas)', () => {
  it('HU-17.CA1 — el seguimiento con demora avisa a la Coordinación y la confirmación lo dice', async () => {
    hoy = '2026-12-04';
    baseDeDatos.fechaSeguimiento = '2026-12-04T15:00:00.000Z';
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.post('/incapacidades/1/seguimiento').attach('evidencia', PDF, 'gestion.pdf');
    expect(res.status).toBe(303);
    expect(enviados.map((m) => m.to)).toEqual([DESTINATARIOS.coordinacion]);
    const pagina = await agente.get(res.headers.location);
    expect(pagina.text).toContain('Se avisó del retraso por correo a la Coordinación de Administración de Personal.');
    expect(pagina.text).toContain('aviso a la Coordinación');
  });

  it('HU-17.CA2 — con demora la pantalla ofrece «Acuerdo de pago» con su formulario', async () => {
    hoy = '2026-12-04';
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/seguimiento?accion=acuerdo');
    expect(res.text).toContain('Acuerdo de pago</a>');
    expect(res.text).toContain('action="/incapacidades/1/acuerdo"');
    expect(res.text).toMatch(/data-panel-respuesta="acuerdo">/); // abierto sin JavaScript
    expect(res.text).toContain('min="2026-11-21"');
    expect(res.text).toContain('max="2027-12-04"');
  });

  it('DA-42 — sin demora no se ofrece el acuerdo (ni con ?accion=acuerdo)', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/seguimiento?accion=acuerdo');
    expect(res.text).not.toContain('action="/incapacidades/1/acuerdo"');
    expect(res.text).toMatch(/data-panel-respuesta="seguimiento">/);
  });

  it('HU-17.CA2 — registra el acuerdo, confirma y lo muestra en la línea de tiempo', async () => {
    hoy = '2026-12-04';
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await acordar(agente);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/incapacidades/1/seguimiento?acuerdo=1');
    const pagina = await agente.get(res.headers.location);
    expect(pagina.text).toContain('Acuerdo registrado: Nueva EPS pagará $ 1.250.000 el martes 15 de diciembre de 2026.');
    expect(pagina.text).toContain('Acuerdo de pago · <span class="cifra">$ 1.250.000</span>');
    expect(pagina.text).toContain('La entidad se comprometió a pagar el 15 dic 2026');
  });

  it('DA-42 — datos no válidos: 400, conserva lo escrito y deja abierto el acuerdo', async () => {
    hoy = '2026-12-04';
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await acordar(agente, { fecha: '2030-01-01', valor: '"><b>x' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('La fecha no puede ser más de un año después de hoy.');
    expect(res.text).toContain('Escriba el valor en pesos');
    expect(res.text).toContain('value="2030-01-01"');
    expect(res.text).not.toContain('"><b>x');
    expect(res.text).toMatch(/data-panel-respuesta="acuerdo">/);
    expect(baseDeDatos.acuerdos).toHaveLength(0);
  });

  it('DA-42 — sin demora: 409 con el mensaje', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await acordar(agente);
    expect(res.status).toBe(409);
    expect(res.text).toContain('dentro del plazo');
  });

  it('?acuerdo=1 sin acuerdos no muestra la confirmación', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.get('/incapacidades/1/seguimiento?acuerdo=1')).text).not.toContain('Acuerdo registrado');
  });

  it('no existe → 404', async () => {
    hoy = '2026-12-04';
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.post('/incapacidades/99/acuerdo').type('form').send({ fecha: '2026-12-15', valor: '1' })).status).toBe(404);
  });

  it.each(['receptor', 'lider', 'contabilidad', 'cartera'])('DA-02 — %s no registra acuerdos (403)', async (rol) => {
    hoy = '2026-12-04';
    const agente = await agenteCon(request, app, rol);
    expect((await acordar(agente)).status).toBe(403);
    expect(baseDeDatos.acuerdos).toHaveLength(0);
  });
});

describe('HU-17 — el acuerdo se ve en la lista de pendientes', () => {
  it('HU-17.CA2 — la lista muestra el último acuerdo bajo la situación', async () => {
    hoy = '2026-12-04';
    const agente = await agenteCon(request, app, 'auxiliar');
    await acordar(agente, { fecha: '2026-12-10', valor: '900.000' });
    await acordar(agente, { fecha: '2026-12-15', valor: '1.250.000' });
    const res = await agente.get('/seguimiento');
    expect(res.text).toContain('Acuerdo: $ 1.250.000 el 15 dic 2026');
    expect(res.text).not.toContain('Acuerdo: $ 900.000');
  });
});
