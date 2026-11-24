// HU-18 — requerimientos de cobro persuasivo (DS-08), rutas con sesión y persistencia falsa (DA-05, DA-43).
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { formularioDeRegistro, PDF } from '../helpers/fabricas.js';
import { agenteCon, crearSesionFalsa, USUARIOS } from '../helpers/sesion-falsa.js';

let app;
let baseDeDatos;
let hoy;

beforeEach(async () => {
  hoy = '2026-11-21';
  baseDeDatos = crearBaseDeDatosFalsa();
  const control = crearControlIncapacidades({ baseDeDatos, correo: crearCorreoFalso().correo, hoy: () => hoy });
  app = crearApp({ sesion: crearSesionFalsa(), control });
  await control.registrarIncapacidad(formularioDeRegistro({ entidad: '2' }), USUARIOS.receptor);
  await control.registrarRadicacion('1', { radicado: 'NEPS-1', evidencia: PDF }, USUARIOS.auxiliar);
  await control.registrarCobrada('1', { tiempoPago: '10' }); // prometida: 2026-12-01
});

const requerir = (agente, fundamentos = 'Plazo vencido; se reclama el pago de la prestación.') =>
  agente.post('/incapacidades/1/requerimiento').type('form').send({ fundamentos });

describe('HU-18 — requerimientos de cobro persuasivo (rutas)', () => {
  it('HU-18.CA1 — con demora la pantalla muestra el formulario y el contador 0 de 2', async () => {
    hoy = '2026-12-04';
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/requerimientos');
    expect(res.status).toBe(200);
    expect(res.text).toContain('action="/incapacidades/1/requerimiento"');
    expect(res.text).toContain('0 de 2');
    expect(res.text).toContain('3 días de demora');
    expect(res.text).toContain('maxlength="2000"');
  });

  it('DA-43 — sin demora no se ofrece el formulario y se explica por qué', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/requerimientos');
    expect(res.text).not.toContain('action="/incapacidades/1/requerimiento"');
    expect(res.text).toContain('dentro del plazo');
  });

  it('HU-18.CA1 — registra, confirma que faltan requerimientos y lo muestra en la línea de tiempo', async () => {
    hoy = '2026-12-04';
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await requerir(agente);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/incapacidades/1/requerimientos?registrado=1');
    const pagina = await agente.get(res.headers.location);
    expect(pagina.text).toContain('Requerimiento registrado (1 de 2). Falta 1 para el mínimo antes del traslado.');
    expect(pagina.text).toContain('Plazo vencido; se reclama el pago de la prestación.');
    expect(pagina.text).toContain('1 de 2');
  });

  it('HU-18.CA2 — con el segundo requerimiento se cumple el mínimo', async () => {
    hoy = '2026-12-04';
    const agente = await agenteCon(request, app, 'auxiliar');
    await requerir(agente);
    const res = await requerir(agente, 'Segundo requerimiento con la norma aplicable.');
    const pagina = await agente.get(res.headers.location);
    expect(pagina.text).toContain('Ya van 2: se cumple el mínimo de 2 antes del traslado.');
    expect(pagina.text).toContain('Requerimiento 3');
  });

  it('XSS — los fundamentos se escapan al mostrarse', async () => {
    hoy = '2026-12-04';
    const agente = await agenteCon(request, app, 'auxiliar');
    await requerir(agente, '<script>alert(1)</script> con fundamentos');
    const pagina = await agente.get('/incapacidades/1/requerimientos');
    expect(pagina.text).not.toContain('<script>alert(1)</script>');
    expect(pagina.text).toContain('&lt;script&gt;');
  });

  it('DA-43 — fundamentos no válidos: 400 y conserva lo escrito', async () => {
    hoy = '2026-12-04';
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await requerir(agente, '"><b>x');
    expect(res.status).toBe(400);
    expect(res.text).not.toContain('"><b>x');
    const res2 = await requerir(agente, 'corto');
    expect(res2.status).toBe(400);
    expect(res2.text).toContain('Escriba los fundamentos con al menos 10 caracteres.');
    expect(res2.text).toContain('>corto</textarea>');
    expect(baseDeDatos.requerimientos).toHaveLength(0);
  });

  it('DA-05 — sin demora: 409', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await requerir(agente);
    expect(res.status).toBe(409);
    expect(res.text).toContain('dentro del plazo');
  });

  it('?registrado=1 sin requerimientos no muestra la confirmación', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.get('/incapacidades/1/requerimientos?registrado=1')).text).not.toContain('Requerimiento registrado');
  });

  it('no existe → 404', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.get('/incapacidades/99/requerimientos')).status).toBe(404);
    expect((await agente.post('/incapacidades/99/requerimiento').type('form').send({ fundamentos: 'Fundamentos válidos' })).status).toBe(404);
  });

  it.each(['receptor', 'lider', 'contabilidad', 'cartera'])('DA-02 — %s no ve ni registra requerimientos (403)', async (rol) => {
    hoy = '2026-12-04';
    const agente = await agenteCon(request, app, rol);
    expect((await agente.get('/incapacidades/1/requerimientos')).status).toBe(403);
    expect((await requerir(agente)).status).toBe(403);
    expect(baseDeDatos.requerimientos).toHaveLength(0);
  });
});

describe('HU-18 — enlaces desde el seguimiento', () => {
  it('con demora el seguimiento ofrece «Cobro persuasivo»; la lista cuenta los requerimientos', async () => {
    hoy = '2026-12-04';
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.get('/incapacidades/1/seguimiento')).text).toContain('href="/incapacidades/1/requerimientos">Cobro persuasivo</a>');
    await requerir(agente);
    expect((await agente.get('/incapacidades/1/seguimiento')).text).toContain('Cobro persuasivo (1)</a>');
    expect((await agente.get('/seguimiento')).text).toContain('Requerimientos: 1');
  });

  it('sin demora ni requerimientos no se ofrece el enlace', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.get('/incapacidades/1/seguimiento')).text).not.toContain('Cobro persuasivo');
  });
});
