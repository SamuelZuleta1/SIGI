import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { agenteCon, crearSesionFalsa } from '../helpers/sesion-falsa.js';

describe('T-00a — base del proyecto', () => {
  const app = crearApp({ sesion: crearSesionFalsa() });

  it('GET /salud responde ok sin sesión', async () => {
    const res = await request(app).get('/salud');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ estado: 'ok' });
  });

  it('GET / dibuja la vista dentro de layout.ejs, con el usuario y su rol', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<html lang="es">');
    expect(res.text).toContain('<title>Inicio · SIGI</title>');
    expect(res.text).toContain('auxiliar@sigi.test');
    expect(res.text).toContain('Auxiliar de Administración de Personal');
  });

  it('una ruta inexistente responde 404 con la página de error', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/no-existe');
    expect(res.status).toBe(404);
    expect(res.text).toContain('Página no encontrada');
  });

  it('envía las cabeceras de seguridad y no revela Express', async () => {
    const res = await request(app).get('/iniciar-sesion');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
  });

  it('sirve los archivos estáticos de public/', async () => {
    const res = await request(app).get('/css/sigi.css');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/css');
  });

  it('las páginas no usan estilos ni scripts en línea (los bloquearía la CSP)', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    for (const res of [await agente.get('/'), await request(app).get('/iniciar-sesion')]) {
      expect(res.text).not.toMatch(/<script(?![^>]*\ssrc="\/)|<style|\sstyle=|\son[a-z]+=/i);
    }
  });
});
