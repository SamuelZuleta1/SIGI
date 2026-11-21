// HU-14 — registrar el rechazo (DS-06), rutas con sesión y persistencia falsas.
// Diseño: opción A «segmento Aprobó / Rechazó» en el último paso de la línea de tiempo del cobro (DA-39).
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
let control;

beforeEach(async () => {
  baseDeDatos = crearBaseDeDatosFalsa();
  control = crearControlIncapacidades({ baseDeDatos, correo: crearCorreoFalso().correo, hoy: () => '2026-11-21' });
  app = crearApp({ sesion: crearSesionFalsa(), control });
  await control.registrarIncapacidad(formularioDeRegistro({ entidad: '2' }), USUARIOS.receptor);
});

const radicar = (radicado = 'NEPS-2026-118402') => control.registrarRadicacion('1', { radicado, evidencia: PDF }, USUARIOS.auxiliar);
const rechazar = (agente, causal = 'Soporte ilegible', id = 1) => agente.post(`/incapacidades/${id}/rechazo`).type('form').send({ causal });

describe('HU-14 — registrar el rechazo (rutas)', () => {
  it('DA-39 — transcrita: el paso «Respuesta de la entidad» trae el segmento y los dos formularios', async () => {
    await radicar();
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/cobro');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Respuesta de Nueva EPS');
    expect(res.text).toContain('href="/incapacidades/1/cobro" data-respuesta="aprobo" aria-current="true"');
    expect(res.text).toContain('href="/incapacidades/1/cobro?respuesta=rechazo" data-respuesta="rechazo">');
    expect(res.text).toContain('action="/incapacidades/1/rechazo" data-panel-respuesta="rechazo" novalidate hidden');
    expect(res.text).toMatch(/action="\/incapacidades\/1\/cobro" data-panel-respuesta="aprobo" novalidate>/);
  });

  it('DA-39 — sin JavaScript, ?respuesta=rechazo muestra el formulario del rechazo', async () => {
    await radicar();
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/cobro?respuesta=rechazo');
    expect(res.text).toContain('data-respuesta="rechazo" aria-current="true"');
    expect(res.text).toMatch(/action="\/incapacidades\/1\/rechazo" data-panel-respuesta="rechazo" novalidate>/);
    expect(res.text).toContain('data-panel-respuesta="aprobo" novalidate hidden');
  });

  it('HU-14.CA1 — registra, redirige y muestra la causal (mostrarCausal) y el paso siguiente', async () => {
    await radicar();
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await rechazar(agente, 'Falta la epicrisis');
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/incapacidades/1/cobro?rechazada=1');
    expect(baseDeDatos.incapacidades[0]).toMatchObject({ estado: 'rechazada', causalRechazo: 'Falta la epicrisis' });

    const pagina = await agente.get(res.headers.location);
    expect(pagina.text).toContain('<p class="mensaje mensaje-aviso entra" role="status">Rechazo registrado. Causal: Falta la epicrisis');
    expect(pagina.text).toMatch(/<b>Rechazada por la entidad<\/b> <span class="tenue">21 nov 2026<\/span>/);
    expect(pagina.text).toContain('<span class="chip rechazada">Rechazada</span>');
    expect(pagina.text).toContain('Causal: Falta la epicrisis</p>');
    expect(pagina.text).toContain('Pida a Nueva EPS una nueva transcripción');
    expect(pagina.text).toContain('href="/incapacidades/1/radicacion"');
    expect(pagina.text).not.toContain('Registrar el rechazo</button>');
  });

  it('HU-14.CA2 — la radicación de una rechazada muestra la causal y ofrece la nueva radicación', async () => {
    await radicar();
    const agente = await agenteCon(request, app, 'auxiliar');
    await rechazar(agente, 'Falta la epicrisis');
    const res = await agente.get('/incapacidades/1/radicacion');
    expect(res.text).toContain('Causal: Falta la epicrisis');
    expect(res.text).toMatch(/<b>Rechazada por la entidad<\/b> <span class="tenue">21 nov 2026<\/span>/);
    expect(res.text).toContain('action="/incapacidades/1/radicacion"');
  });

  it('HU-14 — causal vacía: 400, deja abierto el formulario del rechazo y no cambia el estado', async () => {
    await radicar();
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await rechazar(agente, '  ');
    expect(res.status).toBe(400);
    expect(res.text).toContain('Escriba la causal que informó la entidad.');
    expect(res.text).toContain('data-respuesta="rechazo" aria-current="true"');
    expect(res.text).toMatch(/action="\/incapacidades\/1\/rechazo" data-panel-respuesta="rechazo" novalidate>/);
    expect(res.text).toContain('aria-invalid="true"');
    expect(baseDeDatos.incapacidades[0].estado).toBe('transcrita');
  });

  it('HU-14 — conserva lo escrito y lo escapa al volver a mostrarlo', async () => {
    await radicar();
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await rechazar(agente, `</textarea><script>x</script>${'a'.repeat(600)}`);
    expect(res.status).toBe(400);
    expect(res.text).toContain('La causal admite hasta 500 caracteres.');
    expect(res.text).toContain('&lt;/textarea&gt;&lt;script&gt;x&lt;/script&gt;');
    expect(res.text).not.toContain('<script>x</script>');
  });

  it('HU-14 — la causal guardada se escapa en la línea de tiempo y en la confirmación', async () => {
    await radicar();
    const agente = await agenteCon(request, app, 'auxiliar');
    await rechazar(agente, '<img src=x onerror=alert(1)>');
    const pagina = await agente.get('/incapacidades/1/cobro?rechazada=1');
    expect(pagina.text).not.toContain('<img src=x');
    expect(pagina.text).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('EST-01 — sin radicar: 409 con el mensaje y enlace a Radicación', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await rechazar(agente);
    expect(res.status).toBe(409);
    expect(res.text).toContain('La incapacidad aún no se ha radicado: radíquela primero.');
    expect(res.text).toContain('href="/incapacidades/1/radicacion"');
    expect(baseDeDatos.incapacidades[0].estado).toBeNull();
  });

  it('EST-01 — ya cobrada: 409 y no cambia nada', async () => {
    await radicar();
    await control.registrarCobrada('1', { tiempoPago: '30' });
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await rechazar(agente);
    expect(res.status).toBe(409);
    expect(res.text).toContain('La entidad ya aprobó la incapacidad: está registrada como cobrada.');
    expect(baseDeDatos.incapacidades[0]).toMatchObject({ estado: 'cobrada', tiempoPago: 30 });
  });

  it('EST-01 — ya rechazada: 409 y conserva la primera causal', async () => {
    await radicar();
    const agente = await agenteCon(request, app, 'auxiliar');
    await rechazar(agente, 'Primera');
    const res = await rechazar(agente, 'Segunda');
    expect(res.status).toBe(409);
    expect(res.text).toContain('La incapacidad ya está rechazada: registre la nueva radicación.');
    expect(baseDeDatos.incapacidades[0].causalRechazo).toBe('Primera');
  });

  it('?rechazada=1 sobre una incapacidad no rechazada: 200 sin confirmación (no falla)', async () => {
    await radicar();
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/cobro?rechazada=1');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('Rechazo registrado.');
  });

  it('incapacidad inexistente: 404', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await rechazar(agente, 'Causal', 999)).status).toBe(404);
    expect((await rechazar(agente, 'Causal', 'abc')).status).toBe(404);
  });
});

describe('HU-02 — solo el auxiliar registra el rechazo (DA-02)', () => {
  it.each(['receptor', 'lider', 'contabilidad', 'cartera'])('%s → 403', async (rol) => {
    await radicar();
    const agente = await agenteCon(request, app, rol);
    expect((await rechazar(agente)).status).toBe(403);
    expect(baseDeDatos.incapacidades[0].estado).toBe('transcrita');
  });

  it('sin sesión → 401, sin cambiar nada', async () => {
    await radicar();
    const res = await request(app).post('/incapacidades/1/rechazo').type('form').send({ causal: 'Soporte ilegible' });
    expect(res.status).toBe(401);
    expect(baseDeDatos.incapacidades[0].estado).toBe('transcrita');
  });
});
