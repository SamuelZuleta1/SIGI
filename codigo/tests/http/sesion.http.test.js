import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { COOKIE_ACCESO, COOKIE_RENOVACION } from '../../src/middleware/autenticacion.js';
import { agenteCon, CONTRASENA, crearSesionFalsa, USUARIOS } from '../helpers/sesion-falsa.js';

let sesion;
let app;
beforeEach(() => {
  sesion = crearSesionFalsa();
  app = crearApp({ sesion });
});

const entrar = (correo, contrasena) =>
  request(app).post('/iniciar-sesion').type('form').send({ correo, contrasena });

const cookies = (res) => Object.fromEntries((res.headers['set-cookie'] ?? []).map((c) => [c.split('=')[0], c]));

describe('HU-01 — iniciar sesión con el correo institucional', () => {
  it('HU-01.CA1 — sin sesión, una página protegida lleva al inicio de sesión', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/iniciar-sesion');
  });

  it('HU-01.CA1 — el inicio de sesión muestra el formulario', async () => {
    const res = await request(app).get('/iniciar-sesion');
    expect(res.status).toBe(200);
    expect(res.text).toContain('name="correo"');
    expect(res.text).toContain('name="contrasena"');
  });

  it('HU-01.CA2 — con credenciales válidas entra y queda con sesión', async () => {
    const res = await entrar(USUARIOS.auxiliar.correo, CONTRASENA);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');

    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.get('/')).status).toBe(200);
  });

  it('HU-01.CA2 — las cookies de sesión son HttpOnly y SameSite', async () => {
    const guardadas = cookies(await entrar(USUARIOS.auxiliar.correo, CONTRASENA));
    for (const nombre of [COOKIE_ACCESO, COOKIE_RENOVACION]) {
      expect(guardadas[nombre]).toMatch(/HttpOnly/i);
      expect(guardadas[nombre]).toMatch(/SameSite=Lax/i);
    }
  });

  it('HU-01.CA2 — acepta el correo con mayúsculas y espacios', async () => {
    const res = await entrar('  AUXILIAR@sigi.test ', CONTRASENA);
    expect(res.status).toBe(302);
  });

  it.each([
    ['contraseña incorrecta', USUARIOS.auxiliar.correo, 'otra-clave'],
    ['correo que no existe', 'nadie@sigi.test', CONTRASENA],
  ])('HU-01.CA2 — %s: no entra y el mensaje es el mismo', async (_caso, correo, contrasena) => {
    const res = await entrar(correo, contrasena);
    expect(res.status).toBe(401);
    expect(res.text).toContain('El correo o la contraseña no son correctos.');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('HU-01.CA2 — datos incompletos: 400 y conserva el correo escrito', async () => {
    const res = await entrar('no-es-correo', '');
    expect(res.status).toBe(400);
    expect(res.text).toContain('value="no-es-correo"');
  });

  it('HU-01.CA2 — el correo escrito se muestra escapado', async () => {
    const res = await entrar('"><script>alert(1)</script>', 'x');
    expect(res.text).not.toContain('<script>alert(1)</script>');
  });

  it('HU-01.CA3 — una petición sin cookie se rechaza con 401', async () => {
    const res = await request(app).post('/cualquier-operacion').type('form').send({});
    expect(res.status).toBe(401);
  });

  it('HU-01.CA3 — una petición con un token inválido se rechaza con 401 y se borra la cookie', async () => {
    const res = await request(app).post('/cualquier-operacion').set('Cookie', `${COOKIE_ACCESO}=falso`).type('form').send({});
    expect(res.status).toBe(401);
    expect(cookies(res)[COOKIE_ACCESO]).toMatch(/Expires=Thu, 01 Jan 1970/);
  });

  it('HU-01.CA3 — una cuenta sin rol asignado no entra', async () => {
    const { acceso } = sesion.abrirSinRol();
    const res = await request(app).get('/').set('Cookie', `${COOKIE_ACCESO}=${acceso}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/iniciar-sesion');
  });

  it('HU-01.CA3 — un envío desde otro sitio se rechaza (CSRF)', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.post('/cerrar-sesion').set('Origin', 'https://otro-sitio.example');
    expect(res.status).toBe(403);
    expect(sesion.cierres).toHaveLength(0);
  });

  it('si el token de acceso venció, la sesión se renueva sola', async () => {
    const inicio = await entrar(USUARIOS.lider.correo, CONTRASENA);
    const guardadas = cookies(inicio);
    const acceso = guardadas[COOKIE_ACCESO].split(';')[0];
    const renovacion = guardadas[COOKIE_RENOVACION].split(';')[0];
    sesion.vencer(acceso.split('=')[1]);

    const res = await request(app).get('/').set('Cookie', `${acceso}; ${renovacion}`);
    expect(res.status).toBe(200);
    expect(cookies(res)[COOKIE_ACCESO]).toBeDefined();
  });

  it('cerrar sesión invalida la sesión y vuelve al inicio de sesión', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.post('/cerrar-sesion');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/iniciar-sesion');
    expect(sesion.cierres).toHaveLength(1);
    expect((await agente.get('/')).status).toBe(302);
  });

  it('con sesión iniciada, /iniciar-sesion lleva al inicio', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/iniciar-sesion');
    expect(res.headers.location).toBe('/');
  });
});

describe('Acceso rápido de pruebas: un botón por actor', () => {
  const correos = Object.fromEntries(Object.values(USUARIOS).map((u) => [u.rol, u.correo]));
  const conAcceso = () => crearApp({ sesion, accesoRapido: { contrasena: CONTRASENA, correos } });
  const rapido = (aplicacion, rol) => request(aplicacion).post('/iniciar-sesion/rapido').type('form').send({ rol });

  it('muestra un botón por actor y conserva el formulario de credenciales', async () => {
    const res = await request(conAcceso()).get('/iniciar-sesion');
    expect(res.text).toContain('name="correo"');
    expect(res.text).toContain('name="contrasena"');
    for (const rol of Object.keys(correos)) expect(res.text).toContain(`name="rol" value="${rol}"`);
  });

  it('la contraseña de prueba nunca llega al navegador', async () => {
    const res = await request(conAcceso()).get('/iniciar-sesion');
    expect(res.text).not.toContain(CONTRASENA);
  });

  it.each(Object.keys(USUARIOS))('entra como %s con un clic', async (rol) => {
    const aplicacion = conAcceso();
    const res = await rapido(aplicacion, rol);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
    const acceso = cookies(res)[COOKIE_ACCESO].split(';')[0];
    expect((await request(aplicacion).get('/').set('Cookie', acceso)).status).toBe(200);
  });

  it.each([['rol inexistente', 'admin'], ['propiedad heredada', 'toString'], ['vacío', '']])(
    '%s: 400 y sin sesión',
    async (_caso, rol) => {
      const res = await rapido(conAcceso(), rol);
      expect(res.status).toBe(400);
      expect(res.headers['set-cookie']).toBeUndefined();
    },
  );

  it('si el usuario de prueba no existe en Auth: 401 y sin sesión', async () => {
    const aplicacion = crearApp({ sesion, accesoRapido: { contrasena: 'otra', correos } });
    const res = await rapido(aplicacion, 'auxiliar');
    expect(res.status).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('sin DEMO_PASSWORD: no hay botones y la ruta no existe', async () => {
    expect((await request(app).get('/iniciar-sesion')).text).not.toContain('/iniciar-sesion/rapido');
    expect((await rapido(app, 'auxiliar')).status).toBe(401); // sin sesión, cualquier ruta desconocida se rechaza
  });

  it('un envío desde otro sitio se rechaza (CSRF)', async () => {
    const res = await request(conAcceso()).post('/iniciar-sesion/rapido').set('Origin', 'https://otro-sitio.example').type('form').send({ rol: 'auxiliar' });
    expect(res.status).toBe(403);
  });
});
