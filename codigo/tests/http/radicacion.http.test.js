// HU-09 — preparar la radicación (DS-04, CU-06), con sesión y persistencia falsas.
// Diseño: opción B «bloque del plazo con barra». Advierte sin bloquear (DA-14).
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { ROLES } from '../../src/models/usuario.model.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { documentoDePrueba, formularioDeRegistro } from '../helpers/fabricas.js';
import { agenteCon, crearSesionFalsa, USUARIOS } from '../helpers/sesion-falsa.js';

let app;
let control;
let hoy;

// Incapacidad 1: accidente de tránsito en Salud Total desde el 10 de noviembre → vence el miércoles 25.
// Incapacidad 2: enfermedad general en Sanitas (solo por correo), 12 meses… 3 años.
beforeEach(async () => {
  hoy = '2026-11-19';
  control = crearControlIncapacidades({ baseDeDatos: crearBaseDeDatosFalsa(), correo: crearCorreoFalso().correo, hoy: () => hoy });
  app = crearApp({ sesion: crearSesionFalsa(), control });
  await control.registrarIncapacidad(formularioDeRegistro({ tipo: 'accidente_transito', entidad: '4', fechaInicio: '2026-11-10' }), USUARIOS.receptor);
  await control.registrarIncapacidad(formularioDeRegistro({ entidad: '3', fechaInicio: '2026-11-03' }), USUARIOS.receptor);
});

describe('HU-09 — preparar la radicación (rutas)', () => {
  it('HU-09.CA1 — muestra la entidad, el canal digital, el plazo y su regla', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/radicacion');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Vence el miércoles 25 de noviembre de 2026');
    expect(res.text).toContain('quedan 6 días');
    expect(res.text).toContain('Al día');
    expect(res.text).toContain('15 días desde el inicio (Salud Total, accidentes de tránsito).');
    expect(res.text).toContain('Transcripción digital en el portal de la entidad');
    expect(res.text).toContain('Límite · 25 nov 2026');
  });

  it('HU-09.CA1 — entidad que exige correo (Sanitas): lo dice en el canal', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/2/radicacion');
    expect(res.text).toContain('Por correo: la transcribe personal de la entidad');
    expect(res.text).toContain('3 años desde el inicio (plazo de Sanitas).');
  });

  it('HU-09.CA2 — por vencer: advierte y responde 200', async () => {
    hoy = '2026-11-22';
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/radicacion');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Por vencer');
    expect(res.text).toContain('quedan 3 días. Radíquela cuanto antes.');
  });

  it('HU-09.CA2 — vencido: advierte que no impide radicar y responde 200', async () => {
    hoy = '2026-11-27';
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/radicacion');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Venció el miércoles 25 de noviembre de 2026');
    expect(res.text).toContain('(hace 2 días). SIGI no impide radicar');
  });

  it('DA-14 — sin verificar lo advierte con el enlace; verificada, no', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    let res = await agente.get('/incapacidades/1/radicacion');
    expect(res.text).toContain('La documentación aún no se verificó');
    expect(res.text).toContain('href="/incapacidades/1/verificacion"');

    const tipos = ['soporte_incapacidad', 'epicrisis', 'furips'];
    await control.registrarDocumentos(1, tipos.map((tipo) => documentoDePrueba({ tipo })), USUARIOS.receptor);
    await control.registrarVerificacion(1);
    res = await agente.get('/incapacidades/1/radicacion');
    expect(res.text).not.toContain('La documentación aún no se verificó');
  });

  it('la verificación archivada ofrece «Preparar radicación»', async () => {
    const tipos = ['soporte_incapacidad', 'epicrisis', 'furips'];
    await control.registrarDocumentos(1, tipos.map((tipo) => documentoDePrueba({ tipo })), USUARIOS.receptor);
    await control.registrarVerificacion(1);
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/verificacion');
    expect(res.text).toContain('href="/incapacidades/1/radicacion"');
  });

  it('búsqueda por número: lleva a la radicación; si no existe, 404 con el mensaje', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.get('/radicacion')).text).toContain('Escriba el número de la incapacidad que va a radicar');
    const encontrada = await agente.get('/radicacion?incapacidad=1');
    expect(encontrada.status).toBe(303);
    expect(encontrada.headers.location).toBe('/incapacidades/1/radicacion');
    const falta = await agente.get('/radicacion?incapacidad=99');
    expect(falta.status).toBe(404);
    expect(falta.text).toContain('No hay una incapacidad con ese número.');
    expect((await agente.get('/incapacidades/abc/radicacion')).status).toBe(404);
  });

  it('el menú muestra «Radicación» al auxiliar', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.get('/').redirects(1)).text).toContain('href="/radicacion"');
  });

  it.each(ROLES.filter((rol) => rol !== 'auxiliar'))('DA-02 — %s no puede preparar la radicación (403)', async (rol) => {
    const agente = await agenteCon(request, app, rol);
    expect((await agente.get('/incapacidades/1/radicacion')).status).toBe(403);
    expect((await agente.get('/radicacion')).status).toBe(403);
    expect((await agente.get('/').redirects(1)).text).not.toContain('href="/radicacion"');
  });
});
