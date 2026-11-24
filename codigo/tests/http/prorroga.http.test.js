// DA-50 (opción C) — registrar una prórroga (rutas), con sesión y persistencia falsas.
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { formularioDeRegistro } from '../helpers/fabricas.js';
import { agenteCon, crearSesionFalsa, USUARIOS } from '../helpers/sesion-falsa.js';

let app;
let baseDeDatos;

// La anterior: 5 días desde el 3 nov (fin 7 nov). La prórroga puede empezar del 8 nov al 8 dic.
beforeEach(async () => {
  baseDeDatos = crearBaseDeDatosFalsa();
  const control = crearControlIncapacidades({ baseDeDatos });
  app = crearApp({ sesion: crearSesionFalsa(), control });
  await control.registrarIncapacidad(formularioDeRegistro(), USUARIOS.receptor);
});

const PRORROGA = { anterior: '1', fechaInicio: '2026-11-08', diasIncapacidad: '10', fechaRecepcion: '2026-11-08' };
const enviar = (agente, datos = {}) => agente.post('/incapacidades/prorroga').type('form').send({ ...PRORROGA, ...datos });

describe('DA-50 — registrar una prórroga (rutas)', () => {
  it('el formulario de registro ofrece «Incapacidad nueva / Prórroga»', async () => {
    const agente = await agenteCon(request, app, 'receptor');
    const res = await agente.get('/incapacidades/nueva');
    expect(res.text).toContain('href="/incapacidades/prorroga"');
    expect(res.text).toMatch(/href="\/incapacidades\/nueva" aria-current="true">Incapacidad nueva/);
  });

  it('paso 1: pide el n.º de la anterior; un n.º que no existe da 404 con el mensaje', async () => {
    const agente = await agenteCon(request, app, 'receptor');
    const paso1 = await agente.get('/incapacidades/prorroga');
    expect(paso1.status).toBe(200);
    expect(paso1.text).toContain('Incapacidad anterior n.º');
    expect(paso1.text).toContain('href="/incapacidades/nueva" aria-current="page"'); // el menú sigue en «Registrar incapacidad»
    const noExiste = await agente.get('/incapacidades/prorroga?anterior=99');
    expect(noExiste.status).toBe(404);
    expect(noExiste.text).toContain('No hay una incapacidad con ese número.');
  });

  it('paso 2: la anterior precargada, con la fecha sugerida y los días del caso', async () => {
    const agente = await agenteCon(request, app, 'receptor');
    const res = await agente.get('/incapacidades/prorroga?anterior=1');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Ana María Gómez');
    expect(res.text).toContain('Enfermedad general · Nueva EPS');
    expect(res.text).toContain('value="2026-11-08" min="2026-11-08" max="2026-12-08"');
    expect(res.text).toContain('esta prórroga empieza en el día 6');
    expect(res.text).toContain('name="anterior" value="1"');
  });

  it.each(['receptor', 'auxiliar'])('%s la registra y vuelve a la confirmación del registro', async (rol) => {
    const agente = await agenteCon(request, app, rol);
    const res = await enviar(agente);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/incapacidades/nueva?registrada=2');
    expect(baseDeDatos.incapacidades[1]).toMatchObject({ prorrogaDe: 1, diasPrevios: 5, diasIncapacidad: 10, creadoPor: USUARIOS[rol].id });
  });

  it('una fecha fuera del rango: 400 con el error junto al campo y lo escrito', async () => {
    const agente = await agenteCon(request, app, 'receptor');
    const res = await enviar(agente, { fechaInicio: '2026-12-09' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('La prórroga debe empezar entre el 8 nov 2026');
    expect(res.text).toContain('value="2026-12-09"');
    expect(baseDeDatos.incapacidades).toHaveLength(1);
  });

  it('la anterior ya tiene prórroga: 409 y ofrece prorrogar la última', async () => {
    const agente = await agenteCon(request, app, 'receptor');
    await enviar(agente);
    const res = await enviar(agente);
    expect(res.status).toBe(409);
    expect(res.text).toContain('ya tiene su prórroga (n.º 2)');
    expect(res.text).toContain('href="/incapacidades/prorroga?anterior=2"');
    expect((await agente.get('/incapacidades/prorroga?anterior=1')).text).not.toContain('Registrar prórroga</button>');
  });

  it('la pantalla de prolongada de un certificado con prórroga lleva a la vigente, también tras un POST', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    // 100 días desde el 1 jun 2026 y su prórroga: el caso pasa de 90 días.
    await baseDeDatos.guardarIncapacidad({ colaborador: { nombre: 'Luis Pérez', correo: 'luis@sigi.test' }, entidad: 2, tipo: 'enfermedad_general', fechaInicio: '2026-06-01', diasIncapacidad: 100, fechaRecepcion: '2026-06-01' }, 'id-auxiliar');
    await baseDeDatos.guardarProrroga(2, { fechaInicio: '2026-09-09', diasIncapacidad: 30, fechaRecepcion: '2026-09-09' }, 'id-auxiliar');
    const res = await agente.get('/incapacidades/2/prolongada');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/incapacidades/3/prolongada');
    const post = await agente.post('/incapacidades/2/falta-concepto').type('form').send({});
    expect(post.status).toBe(303);
    expect(post.headers.location).toBe('/incapacidades/3/prolongada');
    const vigente = await agente.get('/incapacidades/3/prolongada');
    expect(vigente.text).toContain('Día');
    expect(vigente.text).toContain('este certificado cubre los días 101 a 130 del caso');
  });

  it.each(['lider', 'contabilidad', 'cartera'])('DA-02 — %s no registra prórrogas (403)', async (rol) => {
    const agente = await agenteCon(request, app, rol);
    expect((await agente.get('/incapacidades/prorroga')).status).toBe(403);
    expect((await enviar(agente)).status).toBe(403);
    expect(baseDeDatos.incapacidades).toHaveLength(1);
  });
});
