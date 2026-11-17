// Rutas del grupo `reemplazo` (DS-02, CU-03) con sesión y persistencia falsas.
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { formularioDeRegistro } from '../helpers/fabricas.js';
import { agenteCon, crearSesionFalsa, USUARIOS } from '../helpers/sesion-falsa.js';

let app;
let baseDeDatos;

beforeEach(async () => {
  baseDeDatos = crearBaseDeDatosFalsa();
  const control = crearControlIncapacidades({ baseDeDatos });
  app = crearApp({ sesion: crearSesionFalsa(), control });
  await control.registrarIncapacidad(formularioDeRegistro(), USUARIOS.receptor);
});

const registrar = (agente, reemplazo = 'Carlos Ruiz', id = 1) =>
  agente.post(`/incapacidades/${id}/reemplazo`).type('form').send({ reemplazo });

describe('HU-05 — registrar el reemplazo del colaborador (rutas)', () => {
  it('HU-05.CA1 — el líder registra el reemplazo y ve la confirmación', async () => {
    const agente = await agenteCon(request, app, 'lider');
    const res = await registrar(agente);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/incapacidades/1/reemplazo?registrado=1');
    expect(baseDeDatos.reemplazos).toEqual([{ idIncapacidad: 1, reemplazo: 'Carlos Ruiz', creadoPor: 'id-lider' }]);

    const confirmacion = await agente.get(res.headers.location);
    expect(confirmacion.status).toBe(200);
    expect(confirmacion.text).toContain('<strong>Carlos Ruiz</strong> quedó como reemplazo en la incapacidad n.º <strong>1</strong>');
  });

  it('HU-05.CA1 — el menú lleva a pedir el número y de ahí al formulario de la incapacidad', async () => {
    const agente = await agenteCon(request, app, 'lider');
    const entrada = await agente.get('/reemplazo');
    expect(entrada.status).toBe(200);
    expect(entrada.text).toContain('name="incapacidad"');
    expect(entrada.text).toContain('href="/reemplazo" aria-current="page"');

    const busqueda = await agente.get('/reemplazo?incapacidad=1');
    expect(busqueda.status).toBe(303);
    expect(busqueda.headers.location).toBe('/incapacidades/1/reemplazo');

    const formulario = await agente.get(busqueda.headers.location);
    expect(formulario.text).toContain('Ana María Gómez');
    expect(formulario.text).toContain('name="reemplazo"');
    expect(formulario.text).toContain('Registrar reemplazo</button>');
  });

  it('HU-05.CA1 — el líder solo ve los datos para reconocer la incapacidad: sin tipo ni entidad', async () => {
    const agente = await agenteCon(request, app, 'lider');
    const { text } = await agente.get('/incapacidades/1/reemplazo');
    expect(text).not.toContain('Enfermedad general');
    expect(text).not.toContain('Nueva EPS');
  });

  it('HU-05.CA1 — sin nombre responde 400, no guarda y señala el campo', async () => {
    const agente = await agenteCon(request, app, 'lider');
    const res = await registrar(agente, '   ');
    expect(res.status).toBe(400);
    expect(res.text).toContain('Escriba el nombre de quien reemplaza.');
    expect(res.text).toContain('aria-invalid="true"');
    expect(baseDeDatos.reemplazos).toHaveLength(0);
  });

  it.each(['99', 'abc'])('HU-05.CA1 — la incapacidad «%s» no existe: 404 y no guarda', async (id) => {
    const agente = await agenteCon(request, app, 'lider');
    expect((await registrar(agente, 'Carlos Ruiz', id)).status).toBe(404);
    expect((await agente.get(`/incapacidades/${id}/reemplazo`)).status).toBe(404);
    const busqueda = await agente.get(`/reemplazo?incapacidad=${id}`);
    expect(busqueda.status).toBe(404);
    expect(busqueda.text).toContain('No hay una incapacidad con ese número.');
    expect(baseDeDatos.reemplazos).toHaveLength(0);
  });

  it('HU-05.CA2 — con un reemplazo ya registrado el campo llega con su nombre y guardar otro lo sustituye (DA-22)', async () => {
    const agente = await agenteCon(request, app, 'lider');
    await registrar(agente);
    const formulario = await agente.get('/incapacidades/1/reemplazo');
    expect(formulario.text).toContain('value="Carlos Ruiz"');
    expect(formulario.text).toContain('sustituye al anterior');
    expect(formulario.text).toContain('Cambiar reemplazo</button>');

    await registrar(agente, 'Marta Lopera');
    expect(baseDeDatos.reemplazos.map((r) => r.reemplazo)).toEqual(['Marta Lopera']);
  });

  it('el nombre se muestra escapado', async () => {
    const agente = await agenteCon(request, app, 'lider');
    await registrar(agente, '<script>alert(1)</script>');
    const { text } = await agente.get('/incapacidades/1/reemplazo?registrado=1');
    expect(text).not.toContain('<script>alert(1)');
    expect(text).toContain('&lt;script&gt;');
  });

  it('la confirmación no aparece si la incapacidad no tiene reemplazo', async () => {
    const agente = await agenteCon(request, app, 'lider');
    expect((await agente.get('/incapacidades/1/reemplazo?registrado=1')).text).not.toContain('quedó como reemplazo');
  });

  it.each(['receptor', 'auxiliar', 'contabilidad', 'cartera'])('DA-02 — el rol %s no puede registrar el reemplazo ni ve la opción en el menú', async (rol) => {
    const agente = await agenteCon(request, app, rol);
    expect((await agente.get('/reemplazo')).status).toBe(403);
    expect((await agente.get('/incapacidades/1/reemplazo')).status).toBe(403);
    expect((await registrar(agente)).status).toBe(403);
    expect((await agente.get('/')).text).not.toContain('href="/reemplazo"');
    expect(baseDeDatos.reemplazos).toHaveLength(0);
  });

  it('HU-01.CA3 — sin sesión no se registra', async () => {
    expect((await registrar(request(app))).status).toBe(401);
    expect((await request(app).get('/reemplazo')).headers.location).toBe('/iniciar-sesion');
    expect(baseDeDatos.reemplazos).toHaveLength(0);
  });
});
