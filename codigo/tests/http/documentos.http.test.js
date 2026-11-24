// Rutas de registrarDocumentos (DS-01, CU-02) con sesión, persistencia y correo falsos.
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { crearApp } from '../../src/app.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { formularioDeRegistro, PDF, PNG } from '../helpers/fabricas.js';
import { agenteCon, crearSesionFalsa, USUARIOS } from '../helpers/sesion-falsa.js';

let app;
let baseDeDatos;
let enviados;

const montar = (correo) => {
  app = crearApp({ sesion: crearSesionFalsa(), control: crearControlIncapacidades({ baseDeDatos, correo }) });
};

beforeEach(async () => {
  baseDeDatos = crearBaseDeDatosFalsa();
  const falso = crearCorreoFalso();
  enviados = falso.enviados;
  montar(falso.correo);
  await crearControlIncapacidades({ baseDeDatos }).registrarIncapacidad(formularioDeRegistro(), USUARIOS.receptor);
});

const subir = (agente, archivos = { soporte_incapacidad: PDF }, id = 1) => {
  const peticion = agente.post(`/incapacidades/${id}/documentos`);
  for (const [tipo, contenido] of Object.entries(archivos)) peticion.attach(tipo, contenido, `${tipo}.bin`);
  return peticion;
};

describe('HU-04 — registrar la documentación recibida (rutas)', () => {
  it('HU-04.CA1 — el receptor registra, se avisa al auxiliar y ve la confirmación', async () => {
    const agente = await agenteCon(request, app, 'receptor');
    const res = await subir(agente, { soporte_incapacidad: PDF, epicrisis: PNG });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/incapacidades/1/documentos?registrados=2');
    expect(baseDeDatos.documentos.map((d) => d.tipo)).toEqual(['soporte_incapacidad', 'epicrisis']);
    expect(baseDeDatos.documentos[0].creadoPor).toBe('id-receptor');
    expect(enviados).toHaveLength(1);

    const confirmacion = await agente.get(res.headers.location);
    expect(confirmacion.status).toBe(200);
    expect(confirmacion.text).toContain('Se registraron 2 documentos');
    expect(confirmacion.text).toContain('Se avisó al auxiliar por correo.');
  });

  it('HU-04.CA2 — el auxiliar registra, el original queda pendiente y no hay aviso', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await subir(agente);
    expect(res.headers.location).toBe('/incapacidades/1/documentos?registrados=1');
    expect(baseDeDatos.incapacidades[0].originalPendiente).toBe(true);
    expect(enviados).toHaveLength(0);

    const confirmacion = await agente.get(res.headers.location);
    expect(confirmacion.text).toContain('Se registró 1 documento');
    expect(confirmacion.text).toContain('El original en físico quedó como pendiente.');
    expect(confirmacion.text).not.toContain('Se avisó al auxiliar');
    expect(confirmacion.text).toContain('Pendiente en físico');
  });

  it('HU-04.CA1 — si el correo falla, se registra y se advierte', async () => {
    const silencio = vi.spyOn(console, 'error').mockImplementation(() => {});
    montar({ notificarRecepcion: async () => { throw new Error('SMTP caído'); } });
    const agente = await agenteCon(request, app, 'receptor');
    const res = await subir(agente);
    expect(res.headers.location).toBe('/incapacidades/1/documentos?registrados=1&aviso=no');
    expect(baseDeDatos.documentos).toHaveLength(1);
    expect((await agente.get(res.headers.location)).text).toContain('No se pudo enviar el correo de aviso');
    silencio.mockRestore();
  });

  it.each(['receptor', 'auxiliar'])('HU-04.CA1 — el %s ve la incapacidad y una fila por cada uno de los 7 tipos (DA-06)', async (rol) => {
    const agente = await agenteCon(request, app, rol);
    const res = await agente.get('/incapacidades/1/documentos');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Ana María Gómez');
    expect(res.text).toContain('Nueva EPS');
    expect(res.text.match(/type="file"/g)).toHaveLength(7);
    expect(res.text).toContain('enctype="multipart/form-data"');
    expect(res.text).toContain('href="/documentos" aria-current="page"');
  });

  it('HU-04.CA1 — se llega por el número de la incapacidad o desde la confirmación del registro', async () => {
    const agente = await agenteCon(request, app, 'receptor');
    expect((await agente.get('/documentos')).text).toContain('name="incapacidad"');
    expect((await agente.get('/documentos?incapacidad=1')).headers.location).toBe('/incapacidades/1/documentos');
    expect((await agente.get('/incapacidades/nueva?registrada=1')).text).toContain('href="/incapacidades/1/documentos"');
  });

  it.each(['/documentos?incapacidad=99', '/documentos?incapacidad=%3Cscript%3E', '/incapacidades/99/documentos', '/incapacidades/abc/documentos'])(
    'HU-04.CA1 — una incapacidad que no existe responde 404 (%s)',
    async (ruta) => {
      const agente = await agenteCon(request, app, 'receptor');
      const res = await agente.get(ruta);
      expect(res.status).toBe(404);
      expect(res.text).toContain('No hay una incapacidad con ese número.');
      expect(res.text).not.toMatch(/<script>/i);
    },
  );

  it('no registra en una incapacidad que no existe', async () => {
    const agente = await agenteCon(request, app, 'receptor');
    expect((await subir(agente, undefined, 99)).status).toBe(404);
    expect(baseDeDatos.documentos).toHaveLength(0);
  });

  it('sin archivos responde 400 y no registra ni avisa', async () => {
    const agente = await agenteCon(request, app, 'receptor');
    const res = await agente.post('/incapacidades/1/documentos').type('form').send({});
    expect(res.status).toBe(400);
    expect(res.text).toContain('Adjunte al menos un documento.');
    expect(enviados).toHaveLength(0);
  });

  it('un archivo que no es PDF, JPG ni PNG responde 400, marca su fila y no guarda ninguno', async () => {
    const agente = await agenteCon(request, app, 'receptor');
    const res = await subir(agente, { soporte_incapacidad: PDF, furips: Buffer.from('MZ ejecutable') });
    expect(res.status).toBe(400);
    expect(res.text).toContain('id="error-furips"');
    expect(res.text).toContain('El archivo debe ser PDF, JPG o PNG.');
    expect(res.text).not.toContain('id="error-soporte_incapacidad"');
    expect(baseDeDatos.documentos).toHaveLength(0);
  });

  it('un archivo de más de 10 MB responde 400 y no guarda ninguno', async () => {
    const agente = await agenteCon(request, app, 'receptor');
    const res = await subir(agente, { soporte_incapacidad: Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]) });
    expect(res.status).toBe(400);
    expect(res.text).toContain('pesa más de 10 MB');
    expect(baseDeDatos.documentos).toHaveLength(0);
  });

  it('un campo de archivo que no es un tipo de documento responde 400 (DA-06)', async () => {
    const agente = await agenteCon(request, app, 'receptor');
    const res = await subir(agente, { cedula: PDF });
    expect(res.status).toBe(400);
    expect(baseDeDatos.documentos).toHaveLength(0);
  });

  it.each(['lider', 'contabilidad', 'cartera'])('DA-02 — el rol %s no puede registrar documentos ni ve la opción', async (rol) => {
    const agente = await agenteCon(request, app, rol);
    expect((await agente.get('/documentos')).status).toBe(403);
    expect((await agente.get('/incapacidades/1/documentos')).status).toBe(403);
    expect((await subir(agente)).status).toBe(403);
    expect((await agente.get('/')).text).not.toContain('href="/documentos"');
    expect(baseDeDatos.documentos).toHaveLength(0);
  });

  it('HU-01.CA3 — sin sesión no se registran documentos', async () => {
    expect((await subir(request(app))).status).toBe(401);
    expect((await request(app).get('/incapacidades/1/documentos')).headers.location).toBe('/iniciar-sesion');
    expect(baseDeDatos.documentos).toHaveLength(0);
  });

  it('la confirmación solo acepta una cantidad numérica', async () => {
    const agente = await agenteCon(request, app, 'receptor');
    const res = await agente.get('/incapacidades/1/documentos?registrados=%3Cscript%3E');
    expect(res.text).not.toContain('Se registr');
  });
});
