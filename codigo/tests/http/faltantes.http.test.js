// HU-07 — notificar los faltantes desde la página de verificación (DS-03, CU-05), con sesión,
// persistencia y correo falsos. Diseño: opción A «lista bajo el resultado».
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
let baseDeDatos;
let control;
let enviados;

// Incapacidad 1: accidente de tránsito con el soporte; faltan la epicrisis y el FURIPS. «Hoy» es el martes 17.
beforeEach(async () => {
  baseDeDatos = crearBaseDeDatosFalsa();
  const correoFalso = crearCorreoFalso();
  enviados = correoFalso.enviados;
  control = crearControlIncapacidades({ baseDeDatos, correo: correoFalso.correo, hoy: () => '2026-11-17' });
  app = crearApp({ sesion: crearSesionFalsa(), control });
  await control.registrarIncapacidad(formularioDeRegistro({ tipo: 'accidente_transito' }), USUARIOS.receptor);
  await control.registrarDocumentos(1, [documentoDePrueba()], USUARIOS.receptor);
  enviados.length = 0;
});

const casilla = (tipo, marcada) =>
  new RegExp(`<input type="checkbox" name="faltantes" value="${tipo}" ${marcada ? 'checked' : ''}>`);

describe('HU-07 — notificar los faltantes (rutas)', () => {
  it('HU-07.CA1 — con faltantes, el formulario llega con los faltantes marcados, el correo y el plazo', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/verificacion');
    expect(res.text).toContain('action="/incapacidades/1/faltantes"');
    expect(res.text).toMatch(casilla('epicrisis', true));
    expect(res.text).toMatch(casilla('furips', true));
    expect(res.text).toContain('<dd>ana.gomez@sigi.test</dd>');
    expect(res.text).toContain('3 días hábiles: hasta el viernes 20 de noviembre de 2026');
    expect(res.text).toContain('Notificar 2 faltantes');
    expect(res.text).toContain('<option value="historia_clinica">Historia clínica</option>');
  });

  it('HU-07.CA1 — notifica: guarda, envía el correo y muestra la confirmación con el aviso registrado', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.post('/incapacidades/1/faltantes').type('form').send('faltantes=epicrisis&faltantes=furips');
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/incapacidades/1/verificacion?notificada=1#aviso');
    expect(baseDeDatos.incapacidades[0]).toMatchObject({ faltantes: ['epicrisis', 'furips'], documentacionCompleta: false });
    expect(enviados).toHaveLength(1);

    const pagina = await agente.get('/incapacidades/1/verificacion?notificada=1');
    expect(pagina.text).toContain('Faltantes notificados. Se envió el correo a <strong>ana.gomez@sigi.test</strong>.');
    expect(pagina.text).toContain('Aviso registrado el martes 17 de noviembre de 2026');
    expect(pagina.text).toContain('Vence el viernes 20 de noviembre de 2026 · quedan 3 días hábiles');
    expect(pagina.text).toContain('ya se notificó al colaborador');
    expect(pagina.text).not.toContain('action="/incapacidades/1/faltantes"');
  });

  it('?notificada=1 escrito a mano no muestra la confirmación si no hay un aviso', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/verificacion?notificada=1');
    expect(res.text).not.toContain('Faltantes notificados.');
  });

  it('DA-30 — «Añadir» vuelve por GET con lo marcado y el documento añadido, sin JavaScript', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const pagina = await agente.get('/incapacidades/1/verificacion');
    expect(pagina.text).toContain('formmethod="get" formaction="/incapacidades/1/verificacion#aviso"');

    const res = await agente.get('/incapacidades/1/verificacion?faltantes=furips&otro=historia_clinica&accion=agregar');
    expect(res.text).toMatch(casilla('epicrisis', false)); // desmarcada por el auxiliar, sigue en la lista
    expect(res.text).toMatch(casilla('furips', true));
    expect(res.text).toMatch(casilla('historia_clinica', true));
    expect(res.text).toContain('Historia clínica<small>Añadido por usted</small>');
    expect(res.text).not.toContain('<option value="historia_clinica">');
  });

  it('DA-30 — sin documentos marcados responde 409, no envía y conserva el formulario', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.post('/incapacidades/1/faltantes').type('form').send({});
    expect(res.status).toBe(409);
    expect(res.text).toContain('Marque al menos un documento.');
    expect(res.text).toMatch(casilla('epicrisis', false));
    expect(enviados).toHaveLength(0);
  });

  it('DA-31 — con un aviso pendiente, un segundo envío responde 409 y no manda otro correo', async () => {
    await control.notificarFaltantes(1, ['epicrisis', 'furips']);
    enviados.length = 0;
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.post('/incapacidades/1/faltantes').type('form').send({ faltantes: 'furips' });
    expect(res.status).toBe(409);
    expect(res.text).toContain('Ya se notificaron los faltantes.');
    expect(enviados).toHaveLength(0);
  });

  it('HU-07.CA2 — tras registrar documentos se puede volver a notificar y se informa el último aviso', async () => {
    await control.notificarFaltantes(1, ['epicrisis', 'furips']);
    await control.registrarDocumentos(1, [documentoDePrueba({ tipo: 'epicrisis' })], USUARIOS.receptor);
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/verificacion');
    expect(res.text).toContain('Último aviso: martes 17 de noviembre de 2026. Después se registraron documentos y todavía falta 1.');
    expect(res.text).toMatch(casilla('furips', true));
    expect(res.text).not.toMatch(/value="epicrisis" (checked)?>/);
  });

  it('si el correo falla responde 503 y no registra el aviso', async () => {
    const correo = { notificarFaltantes: async () => { throw new Error('SMTP caído'); } };
    const roto = crearApp({ sesion: crearSesionFalsa(), control: crearControlIncapacidades({ baseDeDatos, correo, hoy: () => '2026-11-17' }) });
    const agente = await agenteCon(request, roto, 'auxiliar');
    const res = await agente.post('/incapacidades/1/faltantes').type('form').send({ faltantes: 'epicrisis' });
    expect(res.status).toBe(503);
    expect(res.text).toContain('No se pudo enviar el correo al colaborador');
    expect(baseDeDatos.incapacidades[0].documentacionCompleta).toBeNull();
  });

  it('con la documentación completa no se ofrece notificar', async () => {
    await control.registrarDocumentos(1, [documentoDePrueba({ tipo: 'epicrisis' }), documentoDePrueba({ tipo: 'furips' })], USUARIOS.receptor);
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/verificacion');
    expect(res.text).not.toContain('Notificar al colaborador');
  });

  it('una incapacidad archivada con la exención de la EPS no ofrece notificar ni acepta el envío', async () => {
    await control.registrarIncapacidad(formularioDeRegistro({ tipo: 'enfermedad_laboral', correoColaborador: 'otro@sigi.test' }), USUARIOS.receptor);
    await control.registrarDocumentos(2, [documentoDePrueba()], USUARIOS.receptor);
    await control.registrarVerificacion(2, { epsTranscribio: true });
    enviados.length = 0;
    const agente = await agenteCon(request, app, 'auxiliar');
    const pagina = await agente.get('/incapacidades/2/verificacion');
    expect(pagina.text).toContain('Esta documentación ya se verificó y está archivada en digital.');
    expect(pagina.text).not.toContain('Notificar al colaborador');
    expect(pagina.text).not.toContain('notifique los faltantes');
    const res = await agente.post('/incapacidades/2/faltantes').type('form').send({ faltantes: 'epicrisis' });
    expect(res.status).toBe(409);
    expect(enviados).toHaveLength(0);
    expect(baseDeDatos.incapacidades[1]).toMatchObject({ documentacionCompleta: true, archivadoDigital: true });
  });

  it('una incapacidad inexistente responde 404', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.post('/incapacidades/99/faltantes').type('form').send({ faltantes: 'furips' })).status).toBe(404);
  });

  it.each(ROLES.filter((r) => r !== 'auxiliar'))('DA-02 — %s no puede notificar faltantes (403)', async (rol) => {
    const agente = await agenteCon(request, app, rol);
    const res = await agente.post('/incapacidades/1/faltantes').type('form').send({ faltantes: 'furips' });
    expect(res.status).toBe(403);
    expect(enviados).toHaveLength(0);
  });
});
