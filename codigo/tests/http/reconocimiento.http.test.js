// HU-21 — reconocimiento económico (DS-09), rutas con sesión y persistencia falsa (DA-02, DA-09, DA-10, DA-46).
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

const registrar = (dias) => control.registrarIncapacidad(formularioDeRegistro({ diasIncapacidad: String(dias) }), USUARIOS.receptor);
const calcular = (agente, ibc, id = 1) => agente.post(`/incapacidades/${id}/reconocimiento`).type('form').send({ ibc });

beforeEach(async () => {
  baseDeDatos = crearBaseDeDatosFalsa();
  control = crearControlIncapacidades({ baseDeDatos, correo: crearCorreoFalso().correo });
  app = crearApp({ sesion: crearSesionFalsa(), control });
  await registrar(10);
});

describe('HU-21 — reconocimiento económico (rutas)', () => {
  it('el auxiliar ve la lista con el menú «Reconocimiento»', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/reconocimiento');
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="/incapacidades/1/reconocimiento"');
    expect(res.text).toContain('Sin calcular');
    expect(res.text).toContain('href="/reconocimiento"');
  });

  it('la pantalla pide el IBC y no muestra resultado todavía', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/reconocimiento');
    expect(res.status).toBe(200);
    expect(res.text).toContain('name="ibc"');
    expect(res.text).not.toContain('A cargo de la empresa');
  });

  it('HU-21 — calcula, guarda y muestra los tramos y los totales', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await calcular(agente, '3.000.000');
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/incapacidades/1/reconocimiento?calculado=1');
    const pagina = await agente.get(res.headers.location);
    expect(pagina.text).toContain('Cálculo guardado.');
    expect(pagina.text).toContain('Días 1 y 2');
    expect(pagina.text).toContain('A cargo de la empresa');
    expect(pagina.text).toContain('$ 200.000');
    expect(pagina.text).toContain('$ 536.000');
    expect(pagina.text).not.toContain('Trámite de pensión');
    expect((await agente.get('/reconocimiento')).text).toContain('Calculado');
  });

  it('un enlace copiado con ?calculado=1 no muestra la confirmación si no hay cálculo', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.get('/incapacidades/1/reconocimiento?calculado=1')).text).not.toContain('Cálculo guardado.');
  });

  it('DA-10 — con más de 180 días avisa del trámite de pensión', async () => {
    await registrar(200);
    const agente = await agenteCon(request, app, 'auxiliar');
    await calcular(agente, '3000000', 2);
    const pagina = await agente.get('/incapacidades/2/reconocimiento?calculado=1');
    expect(pagina.text).toContain('Trámite de pensión');
    expect(pagina.text).toContain('20 días desde el día 181');
    expect((await agente.get('/reconocimiento')).text).toContain('Trámite de pensión');
  });

  it('un IBC no válido: 400 con el error junto al campo y lo escrito conservado', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await calcular(agente, 'mucho');
    expect(res.status).toBe(400);
    expect(res.text).toContain('Escriba el IBC en pesos');
    expect(res.text).toContain('value="mucho"');
    expect(baseDeDatos.incapacidades[0].ibc).toBeUndefined();
  });

  it('un IBC por encima del tope: 400 con el mensaje en el campo, sin error 500', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await calcular(agente, '900.000.000.000');
    expect(res.status).toBe(400);
    expect(res.text).toContain('El IBC no puede superar');
    expect(baseDeDatos.incapacidades[0].ibc).toBeUndefined();
  });

  it('el IBC escapa HTML', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await calcular(agente, '"><script>x</script>');
    expect(res.text).not.toContain('<script>x');
  });

  it('una incapacidad que no existe: 404', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.get('/incapacidades/99/reconocimiento')).status).toBe(404);
    expect((await calcular(agente, '1000', 99)).status).toBe(404);
  });

  it.each(['receptor', 'lider', 'contabilidad', 'cartera'])('DA-02 — el rol %s no calcula: 403', async (rol) => {
    const agente = await agenteCon(request, app, rol);
    expect((await agente.get('/reconocimiento')).status).toBe(403);
    expect((await agente.get('/incapacidades/1/reconocimiento')).status).toBe(403);
    expect((await calcular(agente, '3000000')).status).toBe(403);
    expect(baseDeDatos.incapacidades[0].ibc).toBeUndefined();
  });

  it('sin sesión: GET redirige al inicio de sesión y POST responde 401', async () => {
    expect((await request(app).get('/reconocimiento')).status).toBe(302);
    expect((await request(app).post('/incapacidades/1/reconocimiento').type('form').send({ ibc: '1' })).status).toBe(401);
  });
});

describe('Auditoría T-21 a T-24 — la pantalla muestra lo guardado', () => {
  it('si la regla cambió desde el cálculo, muestra los totales guardados y avisa', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    await calcular(agente, '3.000.000');
    Object.assign(baseDeDatos.incapacidades[0], { valorEmpresa: '210000.00' });
    const pagina = await agente.get('/incapacidades/1/reconocimiento');
    expect(pagina.text).toContain('$ 210.000');
    expect(pagina.text).toContain('no coincide');
    expect(pagina.text).toMatch(/calculado el \d{1,2} \w+ \d{4}/);
  });

  it('un IBC con solo un espacio duro: 400 que pide el IBC', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await calcular(agente, ' ');
    expect(res.status).toBe(400);
    expect(res.text).toContain('Escriba el IBC de la incapacidad.');
  });
});

describe('DA-53 — incapacidad pagada (rutas)', () => {
  it('no ofrece el formulario, muestra lo guardado y el POST responde 409', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    await calcular(agente, '3.000.000');
    baseDeDatos.incapacidades[0].estado = 'pagada';
    const pagina = await agente.get('/incapacidades/1/reconocimiento');
    expect(pagina.text).toContain('Pagada: este es el cálculo guardado y ya no se puede cambiar.');
    expect(pagina.text).not.toContain('name="ibc"');
    expect(pagina.text).toContain('$ 200.000');
    const res = await calcular(agente, '6.000.000');
    expect(res.status).toBe(409);
    expect(res.text).toContain('su reconocimiento ya no se calcula ni se cambia');
  });
});
