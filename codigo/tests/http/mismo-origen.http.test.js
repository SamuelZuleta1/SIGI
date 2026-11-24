// mismoOrigen (CSRF, RNF-02): los POST solo pasan con una prueba positiva de que vienen de una página de SIGI.
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { CONTRASENA, USUARIOS, crearSesionFalsa } from '../helpers/sesion-falsa.js';

const app = crearApp({ sesion: crearSesionFalsa() });
const login = () => request(app).post('/iniciar-sesion').type('form');
const credenciales = { correo: USUARIOS.auxiliar.correo, contrasena: CONTRASENA };

describe('mismoOrigen — protección CSRF', () => {
  it('con Sec-Fetch-Site: same-origin pasa (lo que envía el navegador)', async () => {
    const res = await login().set('Sec-Fetch-Site', 'same-origin').send(credenciales);
    expect(res.status).toBe(302);
  });

  it.each(['cross-site', 'same-site', 'none'])('con Sec-Fetch-Site: %s se rechaza con 403', async (sitio) => {
    const res = await login().set('Sec-Fetch-Site', sitio).send(credenciales);
    expect(res.status).toBe(403);
  });

  it('sin ninguna cabecera de origen se rechaza (no se acepta por omisión)', async () => {
    const res = await login().sinNavegador().send(credenciales);
    expect(res.status).toBe(403);
  });

  it('con Origin de otro sitio se rechaza, aunque diga same-origin', async () => {
    const res = await login().set('Sec-Fetch-Site', 'same-origin').set('Origin', 'https://atacante.example').send(credenciales);
    expect(res.status).toBe(403);
  });

  it('con Origin: null (contexto aislado) se rechaza', async () => {
    const res = await login().set('Origin', 'null').send(credenciales);
    expect(res.status).toBe(403);
  });

  it('con Origin del mismo host pasa', async () => {
    const res = await login().set('Host', 'sigi.test').set('Origin', 'https://sigi.test').send(credenciales);
    expect(res.status).toBe(302);
  });

  it('sin Origin, el Referer decide: del mismo host pasa y de otro se rechaza', async () => {
    const conReferer = (referer) => login().set('Host', 'sigi.test').set('Referer', referer).send(credenciales);
    expect((await conReferer('https://sigi.test/iniciar-sesion')).status).toBe(302);
    expect((await conReferer('https://atacante.example/form')).status).toBe(403);
  });

  it('GET no se filtra', async () => {
    expect((await request(app).get('/iniciar-sesion').sinNavegador()).status).toBe(200);
  });
});
