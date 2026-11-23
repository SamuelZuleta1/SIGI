// HU-22 y HU-23 — incapacidades prolongadas (DS-10), rutas con sesión y persistencia falsa (DA-02, DA-19, DA-46).
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { formularioDeRegistro } from '../helpers/fabricas.js';
import { agenteCon, crearSesionFalsa, USUARIOS } from '../helpers/sesion-falsa.js';

let app;
let baseDeDatos;
let control;
let enviados;

const CONCEPTO = 'Concepto favorable de rehabilitación, pronóstico de recuperación en seis meses.';
const registrar = (dias) => control.registrarIncapacidad(formularioDeRegistro({ diasIncapacidad: String(dias) }), USUARIOS.receptor);
const concepto = (agente, texto = CONCEPTO, id = 1) => agente.post(`/incapacidades/${id}/concepto`).type('form').send({ concepto: texto });
const falta = (agente, id = 1) => agente.post(`/incapacidades/${id}/falta-concepto`).type('form').send({});

beforeEach(async () => {
  baseDeDatos = crearBaseDeDatosFalsa();
  const correo = crearCorreoFalso();
  enviados = correo.enviados;
  control = crearControlIncapacidades({ baseDeDatos, correo: correo.correo });
  app = crearApp({ sesion: crearSesionFalsa(), control });
  await registrar(130);
});

describe('HU-22 — reporte de prolongadas (rutas)', () => {
  it('HU-22.CA1 — el auxiliar ve las prolongadas con su hito y el menú «Prolongadas»', async () => {
    await registrar(60);
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/prolongadas');
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="/incapacidades/1/prolongada"');
    expect(res.text).not.toContain('href="/incapacidades/2/prolongada"');
    expect(res.text).toContain('Concepto del día 120');
    expect(res.text).toContain('href="/prolongadas"');
  });

  it('las pestañas vacías explican qué aparecerá', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.get('/prolongadas?ver=falta')).text).toContain('No hay faltas del concepto registradas.');
    expect((await agente.get('/prolongadas?ver=con_concepto')).text).toContain('Aún no hay conceptos registrados.');
  });

  it('la pantalla de una prolongada muestra el formulario del concepto y la opción de la falta', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/prolongada');
    expect(res.status).toBe(200);
    expect(res.text).toContain('name="concepto"');
    expect(res.text).toContain('action="/incapacidades/1/falta-concepto"');
  });

  it('una incapacidad que no es prolongada o no existe: 404', async () => {
    await registrar(60);
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.get('/incapacidades/2/prolongada')).status).toBe(404);
    expect((await agente.get('/incapacidades/99/prolongada')).status).toBe(404);
    expect((await concepto(agente, CONCEPTO, 2)).status).toBe(404);
  });
});

describe('HU-22.CA2 — registrar el concepto (rutas)', () => {
  it('lo registra, confirma y avisa al colaborador; la pantalla ya no ofrece el formulario', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await concepto(agente);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/incapacidades/1/prolongada?concepto=1');
    const pagina = await agente.get(res.headers.location);
    expect(pagina.text).toContain('Concepto registrado y colaborador avisado por correo.');
    expect(pagina.text).toContain(CONCEPTO);
    expect(pagina.text).not.toContain('name="concepto"');
    expect(enviados).toHaveLength(1);
    expect((await agente.get('/prolongadas?ver=con_concepto')).text).toContain('Con concepto');
  });

  it('un enlace copiado con ?concepto=1 no muestra la confirmación si no hay concepto', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.get('/incapacidades/1/prolongada?concepto=1')).text).not.toContain('Concepto registrado y comunicado');
  });

  it('un concepto no válido: 400, conserva lo escrito y no envía correo', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await concepto(agente, 'corto');
    expect(res.status).toBe(400);
    expect(res.text).toContain('al menos 10 caracteres');
    expect(res.text).toContain('>corto</textarea>');
    expect(enviados).toHaveLength(0);
  });

  it('el concepto escapa HTML al mostrarse', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    await concepto(agente, '<script>alert(1)</script> concepto');
    expect((await agente.get('/incapacidades/1/prolongada')).text).not.toContain('<script>alert(1)');
  });

  it('registrarlo dos veces: 409', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    await concepto(agente);
    const res = await concepto(agente);
    expect(res.status).toBe(409);
    expect(res.text).toContain('ya tiene el concepto');
    expect(enviados).toHaveLength(1);
  });
});

describe('DA-47 — antes del día 120 (rutas)', () => {
  it('la pantalla explica que aún no es el momento y no ofrece formularios; los POST responden 409', async () => {
    await registrar(100);
    const agente = await agenteCon(request, app, 'auxiliar');
    const pagina = await agente.get('/incapacidades/2/prolongada');
    expect(pagina.status).toBe(200);
    expect(pagina.text).toContain('Aún no es el momento');
    expect(pagina.text).not.toContain('name="concepto"');
    expect(pagina.text).not.toContain('falta-concepto');
    expect((await concepto(agente, CONCEPTO, 2)).status).toBe(409);
    expect((await falta(agente, 2)).status).toBe(409);
    expect(enviados).toHaveLength(0);
  });
});

describe('HU-23.CA1 — registrar la falta del concepto (rutas)', () => {
  it('la registra, confirma, avisa al colaborador y la deja en su pestaña', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await falta(agente);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/incapacidades/1/prolongada?falta=1');
    const pagina = await agente.get(res.headers.location);
    expect(pagina.text).toContain('Falta del concepto registrada y colaborador avisado.');
    expect(pagina.text).toContain('name="concepto"'); // aún puede registrar el concepto cuando llegue
    expect(pagina.text).not.toContain('action="/incapacidades/1/falta-concepto"');
    expect(enviados).toHaveLength(1);
    expect((await agente.get('/prolongadas?ver=falta')).text).toContain('Falta registrada');
  });

  it('repetirla: 409 y sin otro correo', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    await falta(agente);
    const res = await falta(agente);
    expect(res.status).toBe(409);
    expect(enviados).toHaveLength(1);
  });
});

describe('DA-02 — permisos', () => {
  it.each(['receptor', 'lider', 'contabilidad', 'cartera'])('el rol %s no consulta ni registra: 403', async (rol) => {
    const agente = await agenteCon(request, app, rol);
    expect((await agente.get('/prolongadas')).status).toBe(403);
    expect((await agente.get('/incapacidades/1/prolongada')).status).toBe(403);
    expect((await concepto(agente)).status).toBe(403);
    expect((await falta(agente)).status).toBe(403);
    expect(enviados).toHaveLength(0);
  });

  it('sin sesión: GET redirige al inicio de sesión y POST responde 401', async () => {
    expect((await request(app).get('/prolongadas')).status).toBe(302);
    expect((await request(app).post('/incapacidades/1/concepto').type('form').send({ concepto: CONCEPTO })).status).toBe(401);
  });
});

describe('HU-24 — suspensión del pago (rutas)', () => {
  const suspension = (agente, id = 1) => agente.post(`/incapacidades/${id}/suspension-pago`).type('form').send({});

  it('HU-24.CA1 — el auxiliar la registra, vuelve con la confirmación y se avisa al colaborador', async () => {
    await registrar(200);
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.get('/incapacidades/2/prolongada')).text).toContain('action="/incapacidades/2/suspension-pago"');
    const antes = enviados.length;
    const res = await suspension(agente, 2);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/incapacidades/2/prolongada?suspension=1');
    expect(enviados).toHaveLength(antes + 1);
    const pantalla = await agente.get(res.headers.location);
    expect(pantalla.text).toContain('Suspensión del pago registrada y colaborador avisado.');
    expect(pantalla.text).not.toContain('action="/incapacidades/2/suspension-pago"');
  });

  it('la confirmación no aparece si no se registró', async () => {
    await registrar(200);
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.get('/incapacidades/2/prolongada?suspension=1')).text).not.toContain('Suspensión del pago registrada');
  });

  it('con 180 días o menos no hay formulario y la ruta responde 409', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.get('/incapacidades/1/prolongada')).text).not.toContain('suspension-pago');
    const res = await suspension(agente);
    expect(res.status).toBe(409);
    expect(res.text).toContain('supera los 180 días');
  });

  it('una segunda vez responde 409; una inexistente, 404', async () => {
    await registrar(200);
    const agente = await agenteCon(request, app, 'auxiliar');
    await suspension(agente, 2);
    expect((await suspension(agente, 2)).status).toBe(409);
    expect((await suspension(agente, 99)).status).toBe(404);
  });

  it('solo el auxiliar: otro rol recibe 403 y sin sesión 401', async () => {
    await registrar(200);
    expect((await suspension(await agenteCon(request, app, 'cartera'), 2)).status).toBe(403);
    expect((await suspension(request(app), 2)).status).toBe(401);
    expect(baseDeDatos.incapacidades[1].pagoSuspendido).toBeFalsy();
  });
});
