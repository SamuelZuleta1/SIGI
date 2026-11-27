// HU-11 — consultar estados (DS-05, CU-08), con sesión y persistencia falsas.
// Diseño: opción B «pestañas por estado con conteo». Solo lectura (GET).
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { ROLES } from '../../src/models/usuario.model.js';
import { enlaceConsulta } from '../../src/routes/estados.routes.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { formularioDeRegistro } from '../helpers/fabricas.js';
import { agenteCon, crearSesionFalsa, USUARIOS } from '../helpers/sesion-falsa.js';

let app;
let baseDeDatos;

// 1 Ana (Nueva EPS, 3 nov, registrada) · 2 Jorge (Sanitas, 20 oct, transcrita)
beforeEach(async () => {
  baseDeDatos = crearBaseDeDatosFalsa();
  const control = crearControlIncapacidades({ baseDeDatos, correo: crearCorreoFalso().correo, hoy: () => '2026-11-19' });
  app = crearApp({ sesion: crearSesionFalsa(), control });
  await control.registrarIncapacidad(formularioDeRegistro({ entidad: '2', fechaInicio: '2026-11-03' }), USUARIOS.receptor);
  await control.registrarIncapacidad(
    formularioDeRegistro({ colaborador: 'Jorge <b>Cardona</b>', correoColaborador: 'jorge@sigi.test', entidad: '3', fechaInicio: '2026-10-20' }),
    USUARIOS.receptor,
  );
  baseDeDatos.incapacidades[1].estado = 'transcrita';
});

describe('HU-11 — consultar estados (rutas)', () => {
  it('HU-11.CA1 — sin filtros: tabla con las dos, su estado y las pestañas con el conteo', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/estados');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<b>2</b> incapacidades');
    expect(res.text).toContain('<span class="chip registrada">Registrada</span>');
    expect(res.text).toContain('<span class="chip transcrita">Transcrita</span>');
    expect(res.text).toContain('href="/incapacidades/1/radicacion"');
    expect(res.text).toContain('3 nov 2026');
    expect(res.text).toMatch(/href="\/estados" aria-current="page">\s*Todos<span class="n"><span class="oculto">: <\/span>2<\/span>/);
    expect(res.text).toMatch(/Transcrita<span class="n"><span class="oculto">: <\/span>1<\/span>/);
    // El menú lateral marca la página.
    expect(res.text).toMatch(/href="\/estados" aria-current="page">\s*<svg/);
  });

  it('HU-11.CA1 — la pestaña conserva los demás filtros y marca el estado escogido', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/estados?estado=transcrita&entidad=3');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<b>1</b> incapacidad con estos filtros');
    expect(res.text).toContain('href="/estados?estado=transcrita&amp;entidad=3" aria-current="page"');
    expect(res.text).toContain('href="/estados?estado=registrada&amp;entidad=3"');
    expect(res.text).toContain('<input type="hidden" name="estado" value="transcrita">');
    expect(res.text).toContain('<option value="3" selected>Sanitas</option>');
  });

  it('HU-11.CA1 — sin resultados: lo dice y sugiere quitar filtros', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/estados?estado=pagada');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Ninguna incapacidad cumple estos filtros.');
  });

  it('HU-11 — filtros no válidos: 400 con el mensaje en su campo y sin lista', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/estados?desde=2026-11-10&hasta=2026-11-01');
    expect(res.status).toBe(400);
    expect(res.text).toContain('La fecha «hasta» no puede ser anterior a «desde».');
    expect(res.text).toContain('aria-invalid="true" aria-describedby="error-hasta"');
    expect(res.text).not.toContain('<table');
  });

  it('HU-11 — estado desconocido: 400 y lo dice', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/estados?estado=archivada');
    expect(res.status).toBe(400);
    expect(res.text).toContain('Escoja un estado de la lista.');
  });

  it('seguridad — los nombres y los filtros se escapan en la página', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/estados?colaborador=%22%3E%3Cscript%3Ealert(1)%3C%2Fscript%3E');
    expect(res.text).not.toContain('<script>alert(1)');
    expect(res.text).toContain('&#34;&gt;&lt;script&gt;');
    const todas = await agente.get('/estados');
    expect(todas.text).toContain('Jorge &lt;b&gt;Cardona&lt;/b&gt;');
  });

  it('HU-11.CA2 — la consulta no modifica datos: solo responde a GET', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const antes = structuredClone(baseDeDatos.incapacidades);
    expect((await agente.post('/estados')).status).toBe(404);
    await agente.get('/estados?estado=registrada&colaborador=ana');
    expect(baseDeDatos.incapacidades).toEqual(antes);
  });

  it.each(ROLES.filter((r) => r !== 'auxiliar'))('DA-02 — el rol %s no consulta estados: 403 y sin enlace en el menú', async (rol) => {
    const agente = await agenteCon(request, app, rol);
    expect((await agente.get('/estados')).status).toBe(403);
    expect((await agente.get('/').redirects(1)).text).not.toContain('href="/estados"');
  });

  it('HU-01 — sin sesión: lleva a iniciar sesión', async () => {
    const res = await request(app).get('/estados');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/iniciar-sesion/);
  });

  it('enlaceConsulta — omite los filtros vacíos', () => {
    expect(enlaceConsulta({ estado: '', entidad: '2', colaborador: 'ana maría', desde: '', hasta: '' })).toBe(
      '/estados?entidad=2&colaborador=ana+mar%C3%ADa',
    );
    expect(enlaceConsulta({ estado: '' })).toBe('/estados');
  });
});
