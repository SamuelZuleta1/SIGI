// Prueba los middleware `permitir` y `restringirDocumento` con dos rutas de ensayo.
// Las rutas reales de cada operación se prueban en su módulo.
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { permitir, restringirDocumento } from '../../src/middleware/autenticacion.js';
import { ROLES } from '../../src/models/usuario.model.js';
import { agenteCon, crearSesionFalsa } from '../helpers/sesion-falsa.js';

function crearAppDeEnsayo() {
  const rutasDeEnsayo = express.Router();
  rutasDeEnsayo.post('/ensayo/decision', permitir('registrarDecision'), (req, res) => res.send('hecho'));
  rutasDeEnsayo.get('/ensayo/documento/:tipo', restringirDocumento((req) => req.params.tipo), (req, res) => res.send('archivo'));
  return crearApp({ sesion: crearSesionFalsa(), rutasAdicionales: rutasDeEnsayo });
}

describe('HU-02 / DA-02 — el middleware aplica los permisos', () => {
  const app = crearAppDeEnsayo();

  it.each(ROLES)('DA-02 — registrarDecision con el rol %s', async (rol) => {
    const agente = await agenteCon(request, app, rol);
    const res = await agente.post('/ensayo/decision');
    expect(res.status).toBe(rol === 'cartera' ? 200 : 403);
    if (rol !== 'cartera') expect(res.text).toContain('Su rol no tiene permiso');
  });

  it('DA-02 — sin sesión no llega a comprobar permisos: 401', async () => {
    expect((await request(app).post('/ensayo/decision')).status).toBe(401);
  });

  it.each(ROLES.filter((r) => r !== 'auxiliar').flatMap((rol) => [[rol, 'epicrisis'], [rol, 'historia_clinica']]))(
    'HU-02.CA1 — %s no puede ver %s: 403',
    async (rol, tipo) => {
      const agente = await agenteCon(request, app, rol);
      expect((await agente.get(`/ensayo/documento/${tipo}`)).status).toBe(403);
    },
  );

  it.each(['epicrisis', 'historia_clinica', 'furips'])('HU-02.CA2 — el auxiliar sí ve %s', async (tipo) => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get(`/ensayo/documento/${tipo}`);
    expect(res.status).toBe(200);
    expect(res.text).toBe('archivo');
  });
});
