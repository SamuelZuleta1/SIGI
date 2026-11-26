// Rutas del grupo `verificacion` (DS-03, CU-04) y «ver documento» (DA-06, HU-02), con sesión,
// persistencia y correo falsos.
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

// Incapacidad 1: enfermedad general de 5 días con el soporte (id 1) y la historia clínica (id 2); falta la epicrisis.
beforeEach(async () => {
  baseDeDatos = crearBaseDeDatosFalsa();
  control = crearControlIncapacidades({ baseDeDatos, correo: crearCorreoFalso().correo });
  app = crearApp({ sesion: crearSesionFalsa(), control });
  await control.registrarIncapacidad(formularioDeRegistro(), USUARIOS.receptor);
  await control.registrarDocumentos(1, [documentoDePrueba(), documentoDePrueba({ tipo: 'historia_clinica' })], USUARIOS.receptor);
});

const completar = () => control.registrarDocumentos(1, [documentoDePrueba({ tipo: 'epicrisis' })], USUARIOS.receptor);

describe('HU-06 — verificar la documentación (rutas)', () => {
  it('el número lleva a la verificación de la incapacidad; uno inexistente responde 404', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.get('/verificacion')).status).toBe(200);
    const res = await agente.get('/verificacion?incapacidad=1');
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/incapacidades/1/verificacion');
    const inexistente = await agente.get('/verificacion?incapacidad=99');
    expect(inexistente.status).toBe(404);
    expect(inexistente.text).toContain('No hay una incapacidad con ese número.');
    expect((await agente.get('/incapacidades/99/verificacion')).status).toBe(404);
  });

  it('HU-29 / DA-59 — con el archivo preparado, la epicrisis aparece eliminada y no como faltante ni con la casilla de la EPS', async () => {
    await completar();
    await control.registrarVerificacion(1);
    baseDeDatos.documentos.splice(baseDeDatos.documentos.findIndex((d) => d.tipo === 'epicrisis'), 1);
    baseDeDatos.incapacidades[0].fechaArchivoPreparado = '2026-11-24T15:00:00.000Z';
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/verificacion');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Eliminada al archivar');
    expect(res.text).toContain('La epicrisis se eliminó al preparar el archivo para Gestión Documental.');
    expect(res.text).toContain('<b>1 de 1</b>');
    expect(res.text).not.toContain('Se archivó con la transcripción');
    expect(res.text).not.toContain('Se archivó con la epicrisis.');
    expect(res.text).not.toMatch(/<span class="estado falta">/);
  });

  it('HU-06.CA1 — muestra el cruce: recibidos, faltantes y documentos no obligatorios', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/verificacion');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<b>1 de 2</b>');
    expect(res.text).toMatch(/<tr class="recibido">\s*<td>Soporte de la incapacidad<\/td>/);
    expect(res.text).toMatch(/<tr class="falta">\s*<td>Epicrisis o documento soporte<\/td>/);
    expect(res.text).toContain('Historia clínica <span class="tenue">(no obligatorio)</span>');
    expect(res.text).toContain('href="/documentos/1/archivo"');
    expect(res.text).toContain('href="/documentos/2/archivo"');
    expect(res.text).toContain('Falta 1 documento');
  });

  it('HU-06.CA3 — con faltantes no se ofrece confirmar', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/verificacion');
    expect(res.text).not.toContain('Confirmar y archivar en digital');
  });

  it('HU-06.CA3 — si se fuerza la confirmación con faltantes, responde 409 y no archiva', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.post('/incapacidades/1/verificacion').type('form').send({});
    expect(res.status).toBe(409);
    expect(res.text).toContain('Faltan documentos obligatorios: la documentación no se archivó.');
    expect(baseDeDatos.incapacidades[0]).toMatchObject({ documentacionCompleta: null, archivadoDigital: false });
  });

  it('HU-06.CA2 — completa: confirma, archiva en digital y muestra la confirmación', async () => {
    await completar();
    const agente = await agenteCon(request, app, 'auxiliar');
    const pagina = await agente.get('/incapacidades/1/verificacion');
    expect(pagina.text).toContain('La documentación está completa.');
    expect(pagina.text).toContain('Confirmar y archivar en digital');

    const res = await agente.post('/incapacidades/1/verificacion').type('form').send({});
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/incapacidades/1/verificacion?verificada=1');
    expect(baseDeDatos.incapacidades[0]).toMatchObject({ documentacionCompleta: true, archivadoDigital: true });

    const confirmacion = await agente.get(res.headers.location);
    expect(confirmacion.text).toContain('Verificación registrada.');
    expect(confirmacion.text).not.toContain('Confirmar y archivar en digital');
  });

  it('HU-06.CA2 / DA-26 — con la casilla de la EPS se exime la epicrisis y la confirmación la conserva', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const pagina = await agente.get('/incapacidades/1/verificacion?eps=si');
    expect(pagina.text).toContain('<b>1 de 1</b>');
    expect(pagina.text).toContain('No se exige');
    expect(pagina.text).toContain('<input type="hidden" name="eps" value="si">');

    const res = await agente.post('/incapacidades/1/verificacion').type('form').send({ eps: 'si' });
    expect(res.headers.location).toBe('/incapacidades/1/verificacion?verificada=1&eps=si');
    expect(baseDeDatos.incapacidades[0].archivadoDigital).toBe(true);
  });

  it('?verificada=1 escrito a mano no muestra la confirmación si la incapacidad no está archivada', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/verificacion?verificada=1');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('Verificación registrada.');
  });

  it('la casilla de la EPS vuelve a su sitio tras recargar (ancla #exencion)', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/verificacion');
    expect(res.text).toContain('action="/incapacidades/1/verificacion#exencion" id="exencion"');
  });

  it('una incapacidad ya archivada lo informa y no vuelve a ofrecer confirmar', async () => {
    await completar();
    await control.registrarVerificacion(1);
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/verificacion');
    expect(res.text).toContain('Esta documentación ya se verificó y está archivada en digital.');
    expect(res.text).not.toContain('Confirmar y archivar en digital');
  });

  it('DA-28 — el original pendiente se advierte y no impide confirmar', async () => {
    await control.registrarDocumentos(1, [documentoDePrueba({ tipo: 'epicrisis' })], USUARIOS.auxiliar);
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/verificacion');
    expect(res.text).toContain('El original en físico sigue pendiente.');
    expect(res.text).toContain('Confirmar y archivar en digital');
  });

  it.each(ROLES.filter((r) => r !== 'auxiliar'))('DA-02 — %s no puede verificar (403)', async (rol) => {
    await completar();
    const agente = await agenteCon(request, app, rol);
    expect((await agente.get('/verificacion')).status).toBe(403);
    expect((await agente.get('/incapacidades/1/verificacion')).status).toBe(403);
    expect((await agente.post('/incapacidades/1/verificacion').type('form').send({})).status).toBe(403);
    expect(baseDeDatos.incapacidades[0]).toMatchObject({ documentacionCompleta: null, archivadoDigital: false });
  });

  it('HU-01 — sin sesión, la verificación pide iniciar sesión', async () => {
    const res = await request(app).get('/incapacidades/1/verificacion');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/iniciar-sesion/);
  });
});

describe('DA-06 / HU-02 — ver documento (ruta real)', () => {
  it('HU-02.CA2 / DA-71 — el auxiliar ve la historia clínica: 303 al enlace firmado del bucket, sin caché', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/documentos/2/archivo');
    expect(res.status).toBe(303);
    expect(res.headers.location).toMatch(/\/object\/sign\/documentos\/incapacidades\/1\/historia_clinica-2\.pdf\?token=/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toBe('');
  });

  it('DA-71 — si el archivo ya no está en el bucket: 404', async () => {
    baseDeDatos.enlaceDeArchivo = async () => null;
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/documentos/2/archivo');
    expect(res.status).toBe(404);
    expect(res.text).toContain('El archivo de este documento no está disponible.');
  });

  it.each(ROLES.filter((r) => r !== 'auxiliar'))('HU-02.CA1 — %s no ve la historia clínica ni el soporte (403)', async (rol) => {
    const agente = await agenteCon(request, app, rol);
    expect((await agente.get('/documentos/2/archivo')).status).toBe(403);
    expect((await agente.get('/documentos/1/archivo')).status).toBe(403);
  });

  it('un documento inexistente responde 404', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.get('/documentos/40/archivo')).status).toBe(404);
    expect((await agente.get('/documentos/abc/archivo')).status).toBe(404);
  });
});
