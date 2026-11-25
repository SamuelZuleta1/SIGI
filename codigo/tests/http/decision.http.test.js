// HU-20 — decisión de Cartera y Jurídica (DS-08), rutas con sesión y persistencia falsa (DA-02, DA-18, DA-45).
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { formularioDeRegistro, PDF, trasladarConRequerimientos } from '../helpers/fabricas.js';
import { agenteCon, crearSesionFalsa, USUARIOS } from '../helpers/sesion-falsa.js';

let app;
let baseDeDatos;
let control;
let hoy;

beforeEach(async () => {
  hoy = '2026-11-21';
  baseDeDatos = crearBaseDeDatosFalsa();
  control = crearControlIncapacidades({ baseDeDatos, correo: crearCorreoFalso().correo, hoy: () => hoy });
  app = crearApp({ sesion: crearSesionFalsa(), control });
  await control.registrarIncapacidad(formularioDeRegistro({ entidad: '2' }), USUARIOS.receptor);
  await control.registrarRadicacion('1', { radicado: 'NEPS-1', evidencia: PDF }, USUARIOS.auxiliar);
  await control.registrarCobrada('1', { tiempoPago: '10' }); // prometida: 2026-12-01
  hoy = '2026-12-04';
});

const trasladar = (motivo = '180 días sin pago') => trasladarConRequerimientos(control, 1, { motivo });
const decidir = (agente, decision = 'recuperar') => agente.post('/incapacidades/1/decision').type('form').send({ decision });

describe('HU-20 — decisión de Cartera y Jurídica (rutas)', () => {
  it('el rol cartera ve la lista de trasladadas con el menú «Cobro jurídico»', async () => {
    await trasladar();
    const agente = await agenteCon(request, app, 'cartera');
    const res = await agente.get('/cartera');
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="/incapacidades/1/decision"');
    expect(res.text).toContain('Esperan decisión');
    expect(res.text).toContain('3 días de demora');
    expect(res.text).toContain('href="/cartera"'); // menú
  });

  it('la lista vacía explica cuándo aparecerán', async () => {
    const agente = await agenteCon(request, app, 'cartera');
    expect((await agente.get('/cartera')).text).toContain('No hay incapacidades esperando decisión.');
    expect((await agente.get('/cartera?ver=decididas')).text).toContain('Aún no hay decisiones registradas.');
  });

  it('HU-20.CA1 — la pantalla muestra el traslado, los requerimientos y los dos botones', async () => {
    await control.registrarRequerimiento('1', { fundamentos: 'Fundamentos del primer requerimiento.' }, USUARIOS.auxiliar);
    await trasladar('Deterioro crediticio');
    const agente = await agenteCon(request, app, 'cartera');
    const res = await agente.get('/incapacidades/1/decision');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Fundamentos del primer requerimiento.');
    expect(res.text).toContain('Deterioro crediticio');
    expect(res.text).toContain('name="decision" value="recuperar"');
    expect(res.text).toContain('name="decision" value="dar_de_baja"');
  });

  it('HU-20.CA1 — registra la decisión, confirma y la muestra decidida (ya sin botones)', async () => {
    await trasladar();
    const agente = await agenteCon(request, app, 'cartera');
    const res = await decidir(agente, 'dar_de_baja');
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/incapacidades/1/decision?registrada=1');
    const pagina = await agente.get(res.headers.location);
    expect(pagina.text).toContain('Decisión registrada: dar de baja. La incapacidad sale de los pendientes de pago.');
    expect(pagina.text).toContain('Decisión: Dar de baja');
    expect(pagina.text).not.toContain('name="decision"');
    expect((await agente.get('/cartera?ver=decididas')).text).toContain('Dar de baja');
  });

  it('DA-18 — dada de baja, el auxiliar ya no la ve en el seguimiento y ve la decisión en el cobro jurídico', async () => {
    await trasladar();
    await decidir(await agenteCon(request, app, 'cartera'), 'dar_de_baja');
    const auxiliar = await agenteCon(request, app, 'auxiliar');
    expect((await auxiliar.get('/seguimiento')).text).not.toContain('href="/incapacidades/1/seguimiento"');
    const pagina = await auxiliar.get('/incapacidades/1/requerimientos');
    expect(pagina.text).toContain('Decisión de Cartera y Jurídica: Dar de baja');
  });

  it('recuperar deja el cobro pendiente y el auxiliar puede registrar el pago', async () => {
    await trasladar();
    await decidir(await agenteCon(request, app, 'cartera'), 'recuperar');
    const auxiliar = await agenteCon(request, app, 'auxiliar');
    const pagina = await auxiliar.get('/incapacidades/1/requerimientos');
    expect(pagina.text).toContain('Decisión de Cartera y Jurídica: Recuperar el cobro');
    expect(pagina.text).toContain('action="/incapacidades/1/pago"');
  });

  it('DA-45 — una decisión no válida: 400', async () => {
    await trasladar();
    const agente = await agenteCon(request, app, 'cartera');
    const res = await decidir(agente, 'borrar');
    expect(res.status).toBe(400);
    expect(res.text).toContain('Escoja si recupera el cobro o lo da de baja.');
    expect(baseDeDatos.incapacidades[0].decision ?? null).toBeNull();
  });

  it('DA-02 — Cartera no ve ni decide una incapacidad sin trasladar: 404 sin datos del colaborador', async () => {
    const agente = await agenteCon(request, app, 'cartera');
    for (const res of [await agente.get('/incapacidades/1/decision'), await decidir(agente)]) {
      expect(res.status).toBe(404);
      expect(res.text).not.toContain('Ana María Gómez');
    }
    expect(baseDeDatos.incapacidades[0].decision ?? null).toBeNull();
  });

  it('DA-02 — una incapacidad pagada sale de la vista de Cartera: 404', async () => {
    await trasladar();
    await control.registrarPago('1', { valor: '1.000', fechaPago: '2026-12-04' }, USUARIOS.auxiliar);
    const agente = await agenteCon(request, app, 'cartera');
    expect((await agente.get('/incapacidades/1/decision')).status).toBe(404);
  });

  it('DA-45 — ya decidida: 409', async () => {
    const agente = await agenteCon(request, app, 'cartera');
    await trasladar();
    await decidir(agente);
    const otra = await decidir(agente, 'dar_de_baja');
    expect(otra.status).toBe(409);
    expect(otra.text).toContain('Ya se registró la decisión');
  });

  it('?registrada=1 sin decisión no muestra la confirmación', async () => {
    await trasladar();
    const agente = await agenteCon(request, app, 'cartera');
    expect((await agente.get('/incapacidades/1/decision?registrada=1')).text).not.toContain('Decisión registrada');
  });

  it('no existe → 404', async () => {
    const agente = await agenteCon(request, app, 'cartera');
    expect((await agente.get('/incapacidades/99/decision')).status).toBe(404);
    expect((await agente.post('/incapacidades/99/decision').type('form').send({ decision: 'recuperar' })).status).toBe(404);
  });

  it.each(['receptor', 'lider', 'contabilidad', 'auxiliar'])('DA-02 — %s no ve ni registra decisiones (403)', async (rol) => {
    await trasladar();
    const agente = await agenteCon(request, app, rol);
    expect((await agente.get('/cartera')).status).toBe(403);
    expect((await agente.get('/incapacidades/1/decision')).status).toBe(403);
    expect((await decidir(agente)).status).toBe(403);
    expect(baseDeDatos.incapacidades[0].decision ?? null).toBeNull();
  });

  it('DA-02 — cartera no ve las pantallas del auxiliar', async () => {
    const agente = await agenteCon(request, app, 'cartera');
    expect((await agente.get('/incapacidades/1/requerimientos')).status).toBe(403);
    expect((await agente.post('/incapacidades/1/traslado').type('form').send({ motivo: 'Un motivo' })).status).toBe(403);
  });
});
