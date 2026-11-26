// HU-10 — registrar la radicación (DS-04), rutas con sesión y persistencia falsas.
// Diseño: opción C «línea de tiempo» (el formulario es el último paso). DA-01, DA-14, DA-36.
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { ROLES } from '../../src/models/usuario.model.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { formularioDeRegistro, PDF, PNG } from '../helpers/fabricas.js';
import { agenteCon, crearSesionFalsa, USUARIOS } from '../helpers/sesion-falsa.js';

let app;
let baseDeDatos;

beforeEach(async () => {
  baseDeDatos = crearBaseDeDatosFalsa();
  const control = crearControlIncapacidades({ baseDeDatos, correo: crearCorreoFalso().correo, hoy: () => '2026-11-19' });
  app = crearApp({ sesion: crearSesionFalsa(), control });
  await control.registrarIncapacidad(formularioDeRegistro({ entidad: '2' }), USUARIOS.receptor);
});

const radicar = (agente, { radicado = 'NEPS-2026-118402', evidencia = PDF, nombre = 'pantallazo.pdf' } = {}, id = 1) => {
  const peticion = agente.post(`/incapacidades/${id}/radicacion`).field('radicado', radicado);
  return evidencia ? peticion.attach('evidencia', evidencia, nombre) : peticion;
};

describe('HU-10 — registrar la radicación (rutas)', () => {
  it('HU-10.CA1 — sin radicar: la línea de tiempo termina en el formulario', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/radicacion');
    expect(res.text).toContain('Radicar ante Nueva EPS');
    expect(res.text).toContain('action="/incapacidades/1/radicacion" enctype="multipart/form-data"');
    expect(res.text).toContain('Registrar radicación');
  });

  it('HU-10.CA1 — registra, redirige con la confirmación y la incapacidad queda transcrita', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await radicar(agente);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/incapacidades/1/radicacion?registrada=1');
    expect(baseDeDatos.incapacidades[0].estado).toBe('transcrita');

    const pagina = await agente.get(res.headers.location);
    expect(pagina.text).toContain('Radicación registrada. La incapacidad quedó en «transcrita».');
    expect(pagina.text).toContain('Radicada · NEPS-2026-118402');
    expect(pagina.text).toContain('href="/radicaciones/1/evidencia"');
    expect(pagina.text).toContain('Esperando respuesta de la entidad');
    expect(pagina.text).not.toContain('Registrar radicación</button>');
  });

  it('HU-10.CA1 — sin radicado ni evidencia: 400 con los mensajes y sin guardar', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await radicar(agente, { radicado: '  ', evidencia: null });
    expect(res.status).toBe(400);
    expect(res.text).toContain('Escriba el número de radicado.');
    expect(res.text).toContain('Adjunte la evidencia de la radicación.');
    expect(baseDeDatos.radicaciones).toHaveLength(0);
  });

  it('HU-10.CA1 — evidencia que no es PDF, JPG ni PNG: 400 y conserva el radicado escrito', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await radicar(agente, { radicado: 'RAD-77', evidencia: Buffer.from('MZ'), nombre: 'x.pdf' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('La evidencia debe ser PDF, JPG o PNG.');
    expect(res.text).toContain('value="RAD-77"');
  });

  it('HU-10.CA1 — evidencia de más de 10 MB: 400', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await radicar(agente, { evidencia: Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]) });
    expect(res.status).toBe(400);
    expect(res.text).toContain('El archivo pesa más de 10 MB.');
  });

  it('HU-10.CA2 — rechazada: muestra el rechazo con su causal y permite la nueva radicación', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    await radicar(agente, { radicado: 'RAD-1' });
    Object.assign(baseDeDatos.incapacidades[0], { estado: 'rechazada', causalRechazo: 'Soporte ilegible' }); // HU-14 llega en T-14
    const antes = await agente.get('/incapacidades/1/radicacion');
    expect(antes.text).toContain('Rechazada por la entidad');
    expect(antes.text).toContain('Causal: Soporte ilegible');
    expect(antes.text).toContain('Nueva radicación');

    expect((await radicar(agente, { radicado: 'RAD-2', evidencia: PNG, nombre: 'p.png' })).status).toBe(303);
    const despues = await agente.get('/incapacidades/1/radicacion');
    expect(despues.text.indexOf('RAD-1')).toBeLessThan(despues.text.indexOf('Rechazada por la entidad'));
    expect(despues.text.indexOf('Rechazada por la entidad')).toBeLessThan(despues.text.indexOf('RAD-2'));
    expect(despues.text).toContain('Causal: Soporte ilegible'); // sigue en el rechazo más reciente
    expect(baseDeDatos.incapacidades[0].estado).toBe('transcrita');
  });

  it('HU-10.CA2 — DA-36: ya transcrita, un segundo registro responde 409 y no guarda', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    await radicar(agente);
    const res = await radicar(agente, { radicado: 'RAD-otra' });
    expect(res.status).toBe(409);
    expect(res.text).toContain('ya está radicada (transcrita)');
    expect(baseDeDatos.radicaciones).toHaveLength(1);
  });

  it('radicado de más de 1 KB (petición hecha a mano): el error va en el radicado, 400', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await radicar(agente, { radicado: 'x'.repeat(2000) });
    expect(res.status).toBe(400);
    expect(res.text).toContain('El número de radicado admite máximo 100 caracteres.');
    expect(res.text).not.toContain('No se pudo recibir la evidencia');
  });

  it('radicación sin evidencia guardada (la columna lo admite): sin enlace y su evidencia da 404', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    await radicar(agente);
    baseDeDatos.radicaciones[0].evidencia = null;
    const pagina = await agente.get('/incapacidades/1/radicacion');
    expect(pagina.text).toContain('Radicada · NEPS-2026-118402');
    expect(pagina.text).not.toContain('href="/radicaciones/1/evidencia"');
    expect((await agente.get('/radicaciones/1/evidencia')).status).toBe(404);
  });

  it('incapacidad inexistente: 404', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await radicar(agente, {}, 99)).status).toBe(404);
  });

  it('DA-71 — ver evidencia: 303 al enlace firmado del bucket y sin caché; inexistente, 404', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    await radicar(agente, { evidencia: PNG, nombre: 'Ana María Gómez.png' });
    const res = await agente.get('/radicaciones/1/evidencia');
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`https://supabase.test/storage/v1/object/sign/documentos/${baseDeDatos.radicaciones[0].evidencia}?token=firmado`);
    expect(res.headers.location).not.toMatch(/Ana|Gómez/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toBe('');
    expect((await agente.get('/radicaciones/2/evidencia')).status).toBe(404);
    baseDeDatos.enlaceDeArchivo = async () => null; // la fila existe pero el archivo ya no está en el bucket
    const sinArchivo = await agente.get('/radicaciones/1/evidencia');
    expect(sinArchivo.status).toBe(404);
    expect(sinArchivo.text).toContain('El archivo de la evidencia no está disponible.');
  });

  it.each(ROLES.filter((rol) => rol !== 'auxiliar'))('DA-02 — %s no puede registrar ni ver la evidencia (403)', async (rol) => {
    const agente = await agenteCon(request, app, rol);
    expect((await radicar(agente)).status).toBe(403);
    expect((await agente.get('/radicaciones/1/evidencia')).status).toBe(403);
    expect(baseDeDatos.radicaciones).toHaveLength(0);
  });
});
