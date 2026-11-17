// Rutas del grupo `registro` (DS-01, CU-01) con sesión y persistencia falsas.
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { formularioDeRegistro } from '../helpers/fabricas.js';
import { agenteCon, crearSesionFalsa } from '../helpers/sesion-falsa.js';

let app;
let baseDeDatos;

beforeEach(() => {
  baseDeDatos = crearBaseDeDatosFalsa();
  app = crearApp({ sesion: crearSesionFalsa(), control: crearControlIncapacidades({ baseDeDatos }) });
});

const registrar = (agente, cambios) => agente.post('/incapacidades').type('form').send(formularioDeRegistro(cambios));

describe('HU-03 — registrar incapacidad o licencia (rutas)', () => {
  it.each([
    ['HU-03.CA1', 'receptor'],
    ['HU-03.CA2', 'auxiliar'],
  ])('%s — el %s registra, recibe el identificador y ve la confirmación', async (_ca, rol) => {
    const agente = await agenteCon(request, app, rol);
    const res = await registrar(agente);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/incapacidades/nueva?registrada=1');
    expect(baseDeDatos.incapacidades).toHaveLength(1);
    expect(baseDeDatos.incapacidades[0].creadoPor).toBe(`id-${rol}`);

    const confirmacion = await agente.get(res.headers.location);
    expect(confirmacion.status).toBe(200);
    expect(confirmacion.text).toMatch(/Incapacidad n\.º <strong>1<\/strong> registrada/);
  });

  it.each(['receptor', 'auxiliar'])('HU-03.CA1 — el %s ve el formulario con los 6 datos, los 6 tipos y las entidades', async (rol) => {
    const agente = await agenteCon(request, app, rol);
    const res = await agente.get('/incapacidades/nueva');
    expect(res.status).toBe(200);
    for (const campo of ['colaborador', 'tipo', 'entidad', 'fechaInicio', 'diasIncapacidad', 'fechaRecepcion']) {
      expect(res.text).toContain(`name="${campo}"`);
    }
    expect(res.text.match(/<option value="[a-z_]+"/g)).toHaveLength(6);
    expect(res.text).toContain('Nueva EPS');
    expect(res.text).toContain('href="/incapacidades/nueva" aria-current="page"');
  });

  it('HU-03.CA3 — un tipo fuera de los 6 responde 400, no guarda y conserva lo escrito', async () => {
    const agente = await agenteCon(request, app, 'receptor');
    const res = await registrar(agente, { tipo: 'vacaciones', colaborador: 'Luis <b>Pérez</b>' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('Elija el tipo de incapacidad o licencia.');
    expect(res.text).toContain('value="Luis &lt;b&gt;Pérez&lt;/b&gt;"');
    expect(baseDeDatos.incapacidades).toHaveLength(0);
  });

  it('HU-21.CA3 — el formulario de registro no pide el IBC', async () => {
    const agente = await agenteCon(request, app, 'receptor');
    expect((await agente.get('/incapacidades/nueva')).text).not.toMatch(/ibc/i);
  });

  it.each(['lider', 'contabilidad', 'cartera'])('DA-02 — el rol %s no puede registrar ni ve la opción en el menú', async (rol) => {
    const agente = await agenteCon(request, app, rol);
    expect((await agente.get('/incapacidades/nueva')).status).toBe(403);
    expect((await registrar(agente)).status).toBe(403);
    expect((await agente.get('/')).text).not.toContain('/incapacidades/nueva');
    expect(baseDeDatos.incapacidades).toHaveLength(0);
  });

  it('HU-01.CA3 — sin sesión no se registra', async () => {
    expect((await registrar(request(app))).status).toBe(401);
    expect((await request(app).get('/incapacidades/nueva')).headers.location).toBe('/iniciar-sesion');
    expect(baseDeDatos.incapacidades).toHaveLength(0);
  });

  it('la confirmación solo acepta un identificador numérico', async () => {
    const agente = await agenteCon(request, app, 'receptor');
    const res = await agente.get('/incapacidades/nueva?registrada=%3Cscript%3E');
    expect(res.text).not.toContain('registrada.');
    expect(res.text).not.toMatch(/<script/i);
  });
});
