// HU-01 contra Supabase Auth (nube). Requisitos: proyecto vinculado y `npm run db:usuarios`.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { crearServicioSesion } from '../../src/servicios/sesion.js';

const sesion = crearServicioSesion();
const app = crearApp({ sesion });
const CONTRASENA = process.env.DEMO_PASSWORD;

describe('HU-01 — sesión con Supabase Auth', () => {
  it('HU-01.CA2 — un usuario de demostración inicia sesión y entra con su rol', async () => {
    const agente = request.agent(app);
    const entrada = await agente.post('/iniciar-sesion').type('form').send({ correo: 'cartera1@sigi.test', contrasena: CONTRASENA });
    expect(entrada.status).toBe(302);
    expect(entrada.headers.location).toBe('/');

    // `/` lleva a la pantalla de entrada del rol; sin módulos montados esa pantalla da 404,
    // pero se dibuja dentro del layout con el usuario y su rol (la sesión sirvió).
    const raiz = await agente.get('/');
    expect(raiz.status).toBe(302);
    expect(raiz.headers.location).toBe('/cartera');
    const inicio = await agente.get('/').redirects(1);
    expect(inicio.status).toBe(404);
    expect(inicio.text).toContain('cartera1@sigi.test');
    expect(inicio.text).toContain('Cartera y Jurídica');
  });

  it('HU-01.CA2 — con la contraseña incorrecta no entra', async () => {
    const res = await request(app).post('/iniciar-sesion').type('form').send({ correo: 'cartera1@sigi.test', contrasena: 'incorrecta' });
    expect(res.status).toBe(401);
  });

  it('HU-01.CA3 — un token inventado no vale', async () => {
    expect(await sesion.verificar('eyJhbGciOiJIUzI1NiJ9.e30.invalido')).toBeNull();
  });

  it('HU-01.CA3 — después de cerrar sesión, el token deja de servir para renovar', async () => {
    const abierta = await sesion.iniciarSesion('lider1@sigi.test', CONTRASENA);
    expect(await sesion.verificar(abierta.acceso)).toBeTruthy();
    await sesion.cerrarSesion(abierta.acceso);
    expect(await sesion.renovar(abierta.renovacion)).toBeNull();
  });

  it('la sesión se renueva con el token de renovación', async () => {
    const abierta = await sesion.iniciarSesion('receptor1@sigi.test', CONTRASENA);
    const nueva = await sesion.renovar(abierta.renovacion);
    expect(nueva.acceso).toBeTruthy();
    expect((await sesion.obtenerUsuario(nueva.idUsuario)).rol).toBe('receptor');
  });
});
