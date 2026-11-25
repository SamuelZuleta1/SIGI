// HU-16 — seguimiento semanal (DS-07), rutas con sesión y persistencia falsas. Diseño DA-41: lista con pestañas y
// línea de tiempo con el segmento «Sigue pendiente / Ya pagó».
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { crearApp } from '../../src/app.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { formularioDeRegistro, PDF } from '../helpers/fabricas.js';
import { agenteCon, crearSesionFalsa, USUARIOS } from '../helpers/sesion-falsa.js';

let app;
let baseDeDatos;
let control;
let hoy;

beforeEach(async () => {
  hoy = '2026-11-21';
  baseDeDatos = crearBaseDeDatosFalsa();
  control = crearControlIncapacidades({ baseDeDatos, correo: crearCorreoFalso().correo, hoy: () => hoy });
  app = crearApp({ sesion: crearSesionFalsa(), control });
  await control.registrarIncapacidad(formularioDeRegistro({ entidad: '2' }), USUARIOS.receptor);
});

const cobrar = async (tiempoPago = '30') => {
  await control.registrarRadicacion('1', { radicado: 'NEPS-1', evidencia: PDF }, USUARIOS.auxiliar);
  await control.registrarCobrada('1', { tiempoPago });
};
const seguir = (agente, archivo = PDF, nombre = 'gestion.pdf') =>
  agente.post('/incapacidades/1/seguimiento').attach('evidencia', archivo, nombre);

describe('HU-16 — seguimiento semanal (rutas)', () => {
  it('HU-16.CA1 — la lista muestra las cobradas pendientes con su situación', async () => {
    await cobrar();
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/seguimiento');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Seguimiento semanal');
    expect(res.text).toContain('href="/incapacidades/1/seguimiento"');
    expect(res.text).toContain('Faltan 30 días');
    expect(res.text).toContain('Sin seguimiento');
    expect(res.text).not.toContain('Toca esta semana</small>'); // recién cobrada (DA-41)
  });

  it('DA-41 — una semana después de cobrada, sin seguimiento, toca esta semana', async () => {
    await cobrar();
    hoy = '2026-11-28';
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/seguimiento?ver=semana');
    expect(res.text).toContain('Toca esta semana</small>');
    expect(res.text).toContain('href="/incapacidades/1/seguimiento"');
  });

  it('HU-16.CA1 — con demora y pestaña «Con demora»', async () => {
    await cobrar('10');
    hoy = '2026-12-04';
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/seguimiento?ver=demora');
    expect(res.text).toContain('3 días de demora');
    expect(res.text).toMatch(/href="\/seguimiento\?ver=demora" aria-current="page"/);
  });

  it('HU-16.CA1 — sin pendientes muestra el mensaje vacío', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/seguimiento');
    expect(res.text).toContain('No hay incapacidades pendientes de pago.');
  });

  it('HU-16.CA3 — registra el seguimiento con evidencia y confirma que está dentro del plazo', async () => {
    await cobrar();
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await seguir(agente);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/incapacidades/1/seguimiento?registrado=1');
    const pagina = await agente.get(res.headers.location);
    expect(pagina.text).toContain('Seguimiento registrado. Nueva EPS está dentro del plazo: pagaría a más tardar el lunes 21 de diciembre de 2026.');
    expect(pagina.text).toContain('href="/seguimientos/1/evidencia"');
  });

  it('HU-16.CA3 — con demora la confirmación lo dice', async () => {
    await cobrar('10');
    hoy = '2026-12-04';
    baseDeDatos.fechaSeguimiento = '2026-12-04T15:00:00.000Z';
    const agente = await agenteCon(request, app, 'auxiliar');
    const pagina = await agente.get((await seguir(agente)).headers.location);
    expect(pagina.text).toContain('Seguimiento registrado. Nueva EPS lleva 3 días de demora');
    expect(pagina.text).toContain('Con 3 días de demora');
  });

  it('HU-17.CA1 — con demora y el aviso de retraso falla: 502 con el mensaje y sin guardar el seguimiento', async () => {
    await cobrar('10');
    hoy = '2026-12-04';
    const correo = crearCorreoFalso().correo;
    correo.notificarRetraso = async () => { throw new Error('SMTP caído'); };
    control = crearControlIncapacidades({ baseDeDatos, correo, hoy: () => hoy });
    app = crearApp({ sesion: crearSesionFalsa(), control });
    const registro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await seguir(agente);
    expect(registro).toHaveBeenCalledWith(expect.stringContaining('aviso de retraso falló'), expect.objectContaining({ idIncapacidad: 1 }));
    registro.mockRestore();
    expect(res.status).toBe(502);
    expect(res.text).toContain('No se pudo avisar a la Coordinación del retraso; no se guardó nada. Intente de nuevo.');
    expect(baseDeDatos.seguimientos).toHaveLength(0);
  });

  it('HU-16.CA3 — sin evidencia o de otro tipo: 400 con el mensaje en su campo', async () => {
    await cobrar();
    const agente = await agenteCon(request, app, 'auxiliar');
    const sin = await agente.post('/incapacidades/1/seguimiento').type('form').send({});
    expect(sin.status).toBe(400);
    expect(sin.text).toContain('Adjunte la evidencia de la gestión');
    const texto = await seguir(agente, Buffer.from('hola'), 'nota.txt');
    expect(texto.status).toBe(400);
    expect(texto.text).toContain('La evidencia debe ser PDF, JPG o PNG.');
    expect(baseDeDatos.seguimientos).toHaveLength(0);
  });

  it('HU-16.CA2 — «Ya pagó» usa la operación del cobro (registrarPago) y vuelve al seguimiento', async () => {
    await cobrar();
    const espia = vi.spyOn(control, 'registrarPago');
    const agente = await agenteCon(request, app, 'auxiliar');
    const pagina = await agente.get('/incapacidades/1/seguimiento?accion=pago');
    expect(pagina.text).toContain('action="/incapacidades/1/pago"');
    expect(pagina.text).toContain('name="origen" value="seguimiento"');

    const res = await agente.post('/incapacidades/1/pago').type('form').send({ valor: '1.250.000', fechaPago: '2026-11-21', origen: 'seguimiento' });
    expect(espia).toHaveBeenCalledTimes(1);
    expect(res.headers.location).toBe('/incapacidades/1/seguimiento?pagado=1');
    const despues = await agente.get(res.headers.location);
    expect(despues.text).toContain('Pago registrado. La incapacidad quedó pagada y sale de los pendientes de pago.');
    expect(despues.text).not.toContain('action="/incapacidades/1/seguimiento"');
    expect((await agente.get('/seguimiento')).text).not.toContain('href="/incapacidades/1/seguimiento"');
  });

  it('HU-16 — sin JavaScript, ?accion=pago abre «Ya pagó» y oculta el seguimiento', async () => {
    await cobrar();
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/seguimiento?accion=pago');
    expect(res.text).toMatch(/data-panel-respuesta="seguimiento" hidden>/);
    expect(res.text).toMatch(/<div data-panel-respuesta="pago">/);
  });

  it('HU-16 — una pagada no admite seguimiento: 409', async () => {
    await cobrar();
    await control.registrarPago('1', { valor: '1.000', fechaPago: '2026-11-21' }, USUARIOS.auxiliar);
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await seguir(agente);
    expect(res.status).toBe(409);
    expect(res.text).toContain('ya está pagada');
  });

  it('confirmaciones de un enlace copiado no aparecen si no ocurrió', async () => {
    await cobrar();
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/seguimiento?registrado=1&pagado=1');
    expect(res.text).not.toContain('Seguimiento registrado');
    expect(res.text).not.toContain('Pago registrado');
  });

  it('ver evidencia: la entrega el servidor sin caché; inexistente → 404', async () => {
    await cobrar();
    const agente = await agenteCon(request, app, 'auxiliar');
    await seguir(agente);
    const res = await agente.get('/seguimientos/1/evidencia');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['cache-control']).toBe('no-store');
    expect((await agente.get('/seguimientos/99/evidencia')).status).toBe(404);
  });

  it('no existe → 404', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.get('/incapacidades/99/seguimiento')).status).toBe(404);
  });

  it.each(['receptor', 'lider', 'contabilidad', 'cartera'])('DA-02 — %s no ve ni registra el seguimiento (403)', async (rol) => {
    await cobrar();
    const agente = await agenteCon(request, app, rol);
    expect((await agente.get('/seguimiento')).status).toBe(403);
    expect((await agente.get('/incapacidades/1/seguimiento')).status).toBe(403);
    expect((await seguir(agente)).status).toBe(403);
    expect(baseDeDatos.seguimientos).toHaveLength(0);
  });

  it('menú: el auxiliar ve «Seguimiento»; el receptor no', async () => {
    const auxiliar = await agenteCon(request, app, 'auxiliar');
    expect((await auxiliar.get('/')).text).toContain('href="/seguimiento"');
    const receptor = await agenteCon(request, app, 'receptor');
    expect((await receptor.get('/')).text).not.toContain('href="/seguimiento"');
  });
});
