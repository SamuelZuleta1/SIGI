import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';

describe('T-00a — base del proyecto', () => {
  const app = crearApp();

  it('GET /salud responde ok', async () => {
    const res = await request(app).get('/salud');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ estado: 'ok' });
  });

  it('GET / dibuja la vista dentro de layout.ejs', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<html lang="es">');
    expect(res.text).toContain('<title>Inicio · SIGI</title>');
    expect(res.text).toContain('Sistema Integral de Gestión de Incapacidades');
  });

  it('una ruta inexistente responde 404 con la página de error', async () => {
    const res = await request(app).get('/no-existe');
    expect(res.status).toBe(404);
    expect(res.text).toContain('Página no encontrada');
  });

  it('envía las cabeceras de seguridad y no revela Express', async () => {
    const res = await request(app).get('/');
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
});
