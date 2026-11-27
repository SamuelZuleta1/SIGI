// HU-13 — registrar cobrada (DS-06), rutas con sesión y persistencia falsas.
// Diseño: opción B «línea de tiempo del cobro» (DA-38).
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

const radicar = () => control.registrarRadicacion('1', { radicado: 'NEPS-2026-118402', evidencia: PDF }, USUARIOS.auxiliar);
const cobrar = (agente, tiempoPago = '30', id = 1) => agente.post(`/incapacidades/${id}/cobro`).type('form').send({ tiempoPago });

describe('HU-13 — registrar cobrada (rutas)', () => {
  it('HU-13.CA1 — transcrita: la línea de tiempo termina en el formulario con los atajos', async () => {
    await radicar();
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/cobro');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Radicada · NEPS-2026-118402');
    expect(res.text).toContain('Respuesta de Nueva EPS');
    expect(res.text).toContain('action="/incapacidades/1/cobro"');
    expect(res.text).toContain('data-tiempo-pago="30"');
    expect(res.text).toContain('data-hoy="2026-11-21"');
  });

  it('HU-13.CA1 — registra, redirige con la confirmación y muestra el tiempo de pago', async () => {
    await radicar();
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await cobrar(agente, '30');
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/incapacidades/1/cobro?registrada=1');
    expect(baseDeDatos.incapacidades[0]).toMatchObject({ estado: 'cobrada', tiempoPago: 30, fechaCobrada: '2026-11-21' });

    const pagina = await agente.get(res.headers.location);
    expect(pagina.text).toContain('Incapacidad registrada como cobrada. Tiempo de pago: 30 días, a más tardar el lunes 21 de diciembre de 2026.');
    expect(pagina.text).toContain('Cobrada · Nueva EPS aprobó');
    expect(pagina.text).toContain('Esperando el pago');
    expect(pagina.text).not.toContain('Registrar como cobrada</button>');
  });

  it('HU-13 — tiempo no válido: 400, conserva lo escrito y no cambia el estado', async () => {
    await radicar();
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await cobrar(agente, '400');
    expect(res.status).toBe(400);
    expect(res.text).toContain('Escriba entre 1 y 365 días.');
    expect(res.text).toContain('value="400"');
    expect(res.text).toContain('aria-invalid="true"');
    expect(baseDeDatos.incapacidades[0].estado).toBe('transcrita');
  });

  it('HU-13 — lo escrito se escapa al volver a mostrarlo', async () => {
    await radicar();
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await cobrar(agente, '"><b>x');
    expect(res.status).toBe(400);
    expect(res.text).not.toContain('"><b>x');
  });

  it('EST-01 — sin radicar: 409 con el mensaje y enlace a Radicación', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await cobrar(agente);
    expect(res.status).toBe(409);
    expect(res.text).toContain('La incapacidad aún no se ha radicado: radíquela primero.');
    expect(res.text).toContain('href="/incapacidades/1/radicacion"');
    expect(baseDeDatos.incapacidades[0].estado).toBeNull();
  });

  it('EST-01 — ya cobrada: 409 y conserva el primer tiempo de pago', async () => {
    await radicar();
    const agente = await agenteCon(request, app, 'auxiliar');
    await cobrar(agente, '30');
    const res = await cobrar(agente, '60');
    expect(res.status).toBe(409);
    expect(res.text).toContain('La incapacidad ya está registrada como cobrada.');
    expect(baseDeDatos.incapacidades[0].tiempoPago).toBe(30);
  });

  it('?registrada=1 sobre una incapacidad no cobrada: 200 sin confirmación (no falla)', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const sinRadicar = await agente.get('/incapacidades/1/cobro?registrada=1');
    expect(sinRadicar.status).toBe(200);
    expect(sinRadicar.text).not.toContain('Incapacidad registrada como cobrada.');
    await radicar();
    const transcrita = await agente.get('/incapacidades/1/cobro?registrada=1');
    expect(transcrita.status).toBe(200);
    expect(transcrita.text).not.toContain('Incapacidad registrada como cobrada.');
    expect(transcrita.text).toContain('Registrar como cobrada</button>');
  });

  it('incapacidad inexistente: 404 en la consulta y en el registro', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.get('/incapacidades/999/cobro')).status).toBe(404);
    expect((await cobrar(agente, '30', 999)).status).toBe(404);
    expect((await agente.get('/incapacidades/abc/cobro')).status).toBe(404);
  });

  it('entrada del menú: busca por número y redirige; número desconocido → 404', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const vacia = await agente.get('/cobro');
    expect(vacia.status).toBe(200);
    expect(vacia.text).toContain('href="/cobro" aria-current="page"');
    const res = await agente.get('/cobro?incapacidad=1');
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/incapacidades/1/cobro');
    const no = await agente.get('/cobro?incapacidad=77');
    expect(no.status).toBe(404);
    expect(no.text).toContain('No hay una incapacidad con ese número.');
  });

  it('la radicación transcrita enlaza al cobro', async () => {
    await radicar();
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/radicacion');
    expect(res.text).toContain('href="/incapacidades/1/cobro"');
  });
});

describe('HU-02 — solo el auxiliar registra la cobrada (DA-02)', () => {
  it.each(['receptor', 'lider', 'contabilidad', 'cartera'])('%s → 403 y sin entrada en el menú', async (rol) => {
    await radicar();
    const agente = await agenteCon(request, app, rol);
    expect((await agente.get('/incapacidades/1/cobro')).status).toBe(403);
    expect((await agente.get('/cobro')).status).toBe(403);
    expect((await cobrar(agente)).status).toBe(403);
    expect(baseDeDatos.incapacidades[0].estado).toBe('transcrita');
    const inicio = await agente.get('/').redirects(1);
    expect(inicio.text).not.toContain('href="/cobro"');
  });

  it('sin sesión → 401, sin cambiar nada', async () => {
    await radicar();
    const res = await request(app).post('/incapacidades/1/cobro').type('form').send({ tiempoPago: '30' });
    expect(res.status).toBe(401);
    expect(baseDeDatos.incapacidades[0].estado).toBe('transcrita');
  });
});
