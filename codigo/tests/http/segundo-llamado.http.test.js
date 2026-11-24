// HU-08 — registrar el segundo llamado desde la página de verificación (DS-03, CU-05 A1), con sesión,
// persistencia y correo falsos. Diseño: opción D «línea de tiempo + bloque Segundo llamado».
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { ROLES } from '../../src/models/usuario.model.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso, DESTINATARIOS } from '../helpers/correo-falso.js';
import { documentoDePrueba, formularioDeRegistro } from '../helpers/fabricas.js';
import { agenteCon, crearSesionFalsa, USUARIOS } from '../helpers/sesion-falsa.js';

let app;
let baseDeDatos;
let enviados;
let hoy;
let correoFalso;

// Incapacidad 1: aviso del martes 17 por la epicrisis y el FURIPS; vence el viernes 20.
beforeEach(async () => {
  baseDeDatos = crearBaseDeDatosFalsa();
  correoFalso = crearCorreoFalso();
  enviados = correoFalso.enviados;
  hoy = '2026-11-17';
  const control = crearControlIncapacidades({ baseDeDatos, correo: correoFalso.correo, hoy: () => hoy });
  app = crearApp({ sesion: crearSesionFalsa(), control });
  await control.registrarIncapacidad(formularioDeRegistro({ tipo: 'accidente_transito' }), USUARIOS.receptor);
  await control.registrarDocumentos(1, [documentoDePrueba()], USUARIOS.receptor);
  await control.notificarFaltantes(1, ['epicrisis', 'furips']);
  enviados.length = 0;
});

const FORMULARIO = 'action="/incapacidades/1/segundo-llamado"';

describe('HU-08 — registrar el segundo llamado (rutas)', () => {
  it('DA-32 — mientras corre el plazo no se ofrece y la línea de tiempo dice desde cuándo', async () => {
    hoy = '2026-11-19';
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/verificacion');
    expect(res.text).not.toContain(FORMULARIO);
    expect(res.text).toContain('Vence el viernes 20 de noviembre · queda 1 día hábil');
    expect(res.text).toContain('Desde el lunes 23 de noviembre, si no entrega');
  });

  it('HU-08.CA1 — con el plazo vencido se ofrece el bloque con los pendientes y el destinatario', async () => {
    hoy = '2026-11-23';
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/verificacion');
    expect(res.text).toContain(FORMULARIO);
    expect(res.text).toContain('Venció el viernes 20 de noviembre');
    expect(res.text).toContain('<dd>Coordinación de Administración de Personal</dd>');
    expect(res.text).toContain('<dd>Epicrisis o documento soporte, FURIPS</dd>');
    expect(res.text).toContain('Registrar segundo llamado');
  });

  it('HU-08.CA1 — registra: guarda, avisa a la Coordinación y muestra la confirmación', async () => {
    hoy = '2026-11-23';
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.post('/incapacidades/1/segundo-llamado');
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/incapacidades/1/verificacion?llamada=1#segundo-llamado');
    expect(baseDeDatos.incapacidades[0].segundoLlamado).toBe(true);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].to).toBe(DESTINATARIOS.coordinacion);

    const pagina = await agente.get('/incapacidades/1/verificacion?llamada=1');
    expect(pagina.text).toContain('Segundo llamado registrado. Se avisó a la Coordinación para que cite a <strong>Ana María Gómez</strong>.');
    expect(pagina.text).toContain('Coordinación avisada');
    expect(pagina.text).not.toContain(FORMULARIO);
  });

  it('?llamada=1 escrito a mano no muestra la confirmación si no hay segundo llamado', async () => {
    hoy = '2026-11-23';
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/verificacion?llamada=1');
    expect(res.text).not.toContain('Segundo llamado registrado');
    expect(res.text).toContain(FORMULARIO);
  });

  it('DA-32 — un envío antes de que venza el plazo responde 409 y no avisa', async () => {
    hoy = '2026-11-20';
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.post('/incapacidades/1/segundo-llamado');
    expect(res.status).toBe(409);
    expect(res.text).toContain('Podrá registrar el segundo llamado desde el lunes 23 de noviembre de 2026.');
    expect(enviados).toHaveLength(0);
    expect(baseDeDatos.incapacidades[0].segundoLlamado).toBe(false);
  });

  it('DA-33 — un segundo envío responde 409 y no manda otro correo', async () => {
    hoy = '2026-11-23';
    const agente = await agenteCon(request, app, 'auxiliar');
    await agente.post('/incapacidades/1/segundo-llamado');
    const res = await agente.post('/incapacidades/1/segundo-llamado');
    expect(res.status).toBe(409);
    expect(enviados).toHaveLength(1);
  });

  it('si el correo falla responde 503, no registra y conserva el botón para reintentar', async () => {
    hoy = '2026-11-23';
    const roto = { ...correoFalso.correo, notificarCitacion: async () => { throw new Error('SMTP caído'); } };
    const control = crearControlIncapacidades({ baseDeDatos, correo: roto, hoy: () => hoy });
    const appRota = crearApp({ sesion: crearSesionFalsa(), control });
    const agente = await agenteCon(request, appRota, 'auxiliar');
    const res = await agente.post('/incapacidades/1/segundo-llamado');
    expect(res.status).toBe(503);
    expect(res.text).toContain('No se pudo enviar el correo a la Coordinación, así que el segundo llamado no se registró.');
    expect(res.text).toContain(FORMULARIO);
    expect(baseDeDatos.incapacidades[0].segundoLlamado).toBe(false);
  });

  it('sin aviso pendiente (llegaron documentos) responde 409 con el motivo', async () => {
    const control = crearControlIncapacidades({ baseDeDatos, correo: correoFalso.correo, hoy: () => hoy });
    await control.registrarDocumentos(1, [documentoDePrueba({ tipo: 'epicrisis' })], USUARIOS.receptor);
    enviados.length = 0;
    hoy = '2026-11-23';
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.post('/incapacidades/1/segundo-llamado');
    expect(res.status).toBe(409);
    expect(res.text).toContain('No hay un aviso de faltantes pendiente');
    expect(enviados).toHaveLength(0);
  });

  it('una incapacidad inexistente responde 404', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.post('/incapacidades/99/segundo-llamado')).status).toBe(404);
  });

  it.each(ROLES.filter((r) => r !== 'auxiliar'))('DA-02 — %s no puede registrar el segundo llamado (403)', async (rol) => {
    hoy = '2026-11-23';
    const agente = await agenteCon(request, app, rol);
    const res = await agente.post('/incapacidades/1/segundo-llamado');
    expect(res.status).toBe(403);
    expect(enviados).toHaveLength(0);
  });
});
