// HU-19 — traslado a Cartera y Jurídica (DS-08), rutas con sesión, persistencia y correo falsos (DA-05, DA-14, DA-44).
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso, DESTINATARIOS } from '../helpers/correo-falso.js';
import { formularioDeRegistro, PDF } from '../helpers/fabricas.js';
import { agenteCon, crearSesionFalsa, USUARIOS } from '../helpers/sesion-falsa.js';

let app;
let baseDeDatos;
let enviados;
let hoy;

beforeEach(async () => {
  hoy = '2026-11-21';
  baseDeDatos = crearBaseDeDatosFalsa();
  const correoFalso = crearCorreoFalso();
  enviados = correoFalso.enviados;
  const control = crearControlIncapacidades({ baseDeDatos, correo: correoFalso.correo, hoy: () => hoy });
  app = crearApp({ sesion: crearSesionFalsa(), control });
  await control.registrarIncapacidad(formularioDeRegistro({ entidad: '2' }), USUARIOS.receptor);
  await control.registrarRadicacion('1', { radicado: 'NEPS-1', evidencia: PDF }, USUARIOS.auxiliar);
  await control.registrarCobrada('1', { tiempoPago: '10' }); // prometida: 2026-12-01
  hoy = '2026-12-04';
});

const requerir = (agente, n = 1) =>
  agente.post('/incapacidades/1/requerimiento').type('form').send({ fundamentos: `Requerimiento número ${n} de cobro.` });
const trasladar = (agente, motivo = '180 días sin pago') => agente.post('/incapacidades/1/traslado').type('form').send({ motivo });

describe('HU-19 — traslado a Cartera y Jurídica (rutas)', () => {
  it('DA-14 — con menos de dos requerimientos la pantalla advierte y ofrece el traslado', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    await requerir(agente);
    const res = await agente.get('/incapacidades/1/requerimientos');
    expect(res.text).toContain('action="/incapacidades/1/traslado"');
    expect(res.text).toContain('Solo hay 1 de 2 requerimientos. Puede trasladar de todos modos');
    expect(res.text).toContain('maxlength="500"');
  });

  it('con dos requerimientos ya no advierte', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    await requerir(agente, 1);
    await requerir(agente, 2);
    const res = await agente.get('/incapacidades/1/requerimientos');
    expect(res.text).toContain('action="/incapacidades/1/traslado"');
    expect(res.text).not.toContain('Puede trasladar de todos modos');
  });

  it('HU-19.CA1 — traslada, avisa a Cartera y lo muestra en la línea de tiempo', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    await requerir(agente, 1);
    await requerir(agente, 2);
    const res = await trasladar(agente);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/incapacidades/1/requerimientos?trasladado=1');
    expect(enviados.map((m) => m.to)).toEqual([DESTINATARIOS.cartera]);
    const pagina = await agente.get(res.headers.location);
    expect(pagina.text).toContain('Incapacidad trasladada a Cartera y Jurídica; se les avisó por correo.');
    expect(pagina.text).not.toContain('Se trasladó con');
    expect(pagina.text).toContain('Trasladada a Cartera y Jurídica');
    expect(pagina.text).toContain('180 días sin pago');
    expect(pagina.text).not.toContain('action="/incapacidades/1/traslado"');
    expect(pagina.text).not.toContain('action="/incapacidades/1/requerimiento"');
  });

  it('DA-14 — trasladar con un requerimiento se permite y la confirmación lo señala', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    await requerir(agente);
    const res = await trasladar(agente);
    expect(res.status).toBe(303);
    const pagina = await agente.get(res.headers.location);
    expect(pagina.text).toContain('Se trasladó con 1 de 2 requerimientos.');
  });

  it('XSS — el motivo se escapa al mostrarse', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    await trasladar(agente, '<script>alert(1)</script> motivo');
    const pagina = await agente.get('/incapacidades/1/requerimientos');
    expect(pagina.text).not.toContain('<script>alert(1)</script>');
    expect(pagina.text).toContain('&lt;script&gt;');
  });

  it('DA-44 — motivo no válido: 400 y conserva lo escrito', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await trasladar(agente, 'ab');
    expect(res.status).toBe(400);
    expect(res.text).toContain('Escriba el motivo con al menos 3 caracteres.');
    expect(res.text).toContain('>ab</textarea>');
    expect(enviados).toHaveLength(0);
    expect(baseDeDatos.incapacidades[0].motivoTraslado ?? null).toBeNull();
  });

  it('DA-44 — ya trasladada: 409', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    await trasladar(agente);
    const res = await trasladar(agente, 'Otro motivo distinto');
    expect(res.status).toBe(409);
    expect(res.text).toContain('ya se trasladó a Cartera y Jurídica');
    expect(enviados).toHaveLength(1);
  });

  it('DA-05 — sin demora: 409 y la pantalla no ofrece el traslado', async () => {
    hoy = '2026-12-01';
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await trasladar(agente)).status).toBe(409);
    expect((await agente.get('/incapacidades/1/requerimientos')).text).not.toContain('action="/incapacidades/1/traslado"');
  });

  it('?trasladado=1 sin traslado no muestra la confirmación', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.get('/incapacidades/1/requerimientos?trasladado=1')).text).not.toContain('Incapacidad trasladada');
  });

  it('no existe → 404', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.post('/incapacidades/99/traslado').type('form').send({ motivo: '180 días sin pago' })).status).toBe(404);
  });

  it.each(['receptor', 'lider', 'contabilidad', 'cartera'])('DA-02 — %s no traslada (403)', async (rol) => {
    const agente = await agenteCon(request, app, rol);
    expect((await trasladar(agente)).status).toBe(403);
    expect(enviados).toHaveLength(0);
  });
});

describe('HU-19.CA2 — pago posterior al traslado', () => {
  it('HU-19.CA2 — trasladada, la pantalla ofrece el pago con origen cobro-juridico; registrarlo vuelve aquí', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    await trasladar(agente);
    const pantalla = await agente.get('/incapacidades/1/requerimientos');
    expect(pantalla.text).toContain('action="/incapacidades/1/pago"');
    expect(pantalla.text).toContain('name="origen" value="cobro-juridico"');
    hoy = '2026-12-10';
    const res = await agente.post('/incapacidades/1/pago').type('form').send({ valor: '1.250.000', fechaPago: '2026-12-10', origen: 'cobro-juridico' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/incapacidades/1/requerimientos?pagado=1');
    const pagina = await agente.get(res.headers.location);
    expect(pagina.text).toContain('Pago registrado. La incapacidad quedó pagada');
    expect(pagina.text).not.toContain('action="/incapacidades/1/pago"');
    expect(baseDeDatos.incapacidades[0].estado).toBe('pagada');
  });

  it('sin traslado la pantalla no ofrece el pago', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.get('/incapacidades/1/requerimientos')).text).not.toContain('action="/incapacidades/1/pago"');
  });

  it('?pagado=1 sin pago no muestra la confirmación', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.get('/incapacidades/1/requerimientos?pagado=1')).text).not.toContain('Pago registrado');
  });
});
