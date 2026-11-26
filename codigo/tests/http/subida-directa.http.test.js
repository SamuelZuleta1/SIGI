// Subida directa de archivos grandes (Vercel limita la petición a 4,5 MB): el navegador sube al bucket con una URL firmada
// y el formulario solo envía la referencia `subida_<campo>`. Rutas con sesión y persistencia falsas.
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
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

/** Lo que hace el navegador: pide la URL firmada y deja el archivo en el bucket (aquí, el mapa de la base falsa). */
const subir = async (agente, contenido) => {
  const { body } = await agente.post('/subidas').expect(200);
  baseDeDatos.subidas.set(body.ruta, contenido);
  return body.ruta;
};

describe('POST /subidas', () => {
  it('entrega una ruta pendiente del usuario y la URL firmada, sin guardar nada en caché', async () => {
    const agente = await agenteCon(request, app, 'receptor');
    const res = await agente.post('/subidas');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.ruta).toMatch(/^pendientes\/id-receptor\/[0-9a-f-]{36}$/);
    expect(res.body.urlFirmada).toContain(res.body.ruta);
  });

  it.each(['receptor', 'auxiliar'])('lo piden quienes registran archivos (%s)', async (rol) => {
    expect((await (await agenteCon(request, app, rol)).post('/subidas')).status).toBe(200);
  });

  it.each(['lider', 'contabilidad', 'cartera'])('%s no registra archivos: 403', async (rol) => {
    expect((await (await agenteCon(request, app, rol)).post('/subidas')).status).toBe(403);
  });

  it('sin sesión no se entrega nada', async () => {
    expect([302, 303, 401]).toContain((await request(app).post('/subidas')).status);
  });

  it('la CSP permite conectar solo al propio sitio y al origen de Supabase', async () => {
    process.env.SUPABASE_URL = 'https://proyecto.supabase.co';
    try {
      const otra = crearApp({ sesion: crearSesionFalsa(), control: crearControlIncapacidades({ baseDeDatos, correo: crearCorreoFalso().correo }) });
      const res = await request(otra).get('/salud');
      expect(res.headers['content-security-policy']).toContain("connect-src 'self' https://proyecto.supabase.co;");
    } finally {
      delete process.env.SUPABASE_URL;
    }
  });
});

describe('registrar documentos con archivos subidos directo', () => {
  it('registra desde la referencia, valida el contenido real y borra lo pendiente', async () => {
    const agente = await agenteCon(request, app, 'receptor');
    const pdf = await subir(agente, PDF);
    const png = await subir(agente, PNG);
    const res = await agente.post('/incapacidades/1/documentos').type('form').send({ subida_soporte_incapacidad: pdf, subida_epicrisis: png });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/incapacidades/1/documentos?registrados=2');
    expect(baseDeDatos.documentos.map((d) => [d.tipo, d.tipoMime])).toEqual([
      ['soporte_incapacidad', 'application/pdf'],
      ['epicrisis', 'image/png'],
    ]);
    expect(baseDeDatos.subidas.size).toBe(0);
  });

  it('un archivo que no es PDF, JPG ni PNG se rechaza aunque el navegador lo haya subido, y se borra', async () => {
    const agente = await agenteCon(request, app, 'receptor');
    const falso = await subir(agente, Buffer.from('MZ ejecutable'));
    const res = await agente.post('/incapacidades/1/documentos').type('form').send({ subida_soporte_incapacidad: falso });
    expect(res.status).toBe(400);
    expect(res.text).toContain('El archivo debe ser PDF, JPG o PNG.');
    expect(baseDeDatos.documentos).toHaveLength(0);
    expect(baseDeDatos.subidas.size).toBe(0);
  });

  it('una subida que nunca llegó al bucket se informa y no registra nada', async () => {
    const agente = await agenteCon(request, app, 'receptor');
    const { body } = await agente.post('/subidas');
    const res = await agente.post('/incapacidades/1/documentos').type('form').send({ subida_soporte_incapacidad: body.ruta });
    expect(res.status).toBe(400);
    expect(res.text).toContain('El archivo no llegó completo. Adjúntelo de nuevo.');
    expect(baseDeDatos.documentos).toHaveLength(0);
  });

  it('no se puede usar ni borrar la subida de otro usuario ni una ruta cualquiera del bucket', async () => {
    const receptor = await agenteCon(request, app, 'receptor');
    const auxiliar = await agenteCon(request, app, 'auxiliar');
    const ajena = await subir(auxiliar, PDF);
    baseDeDatos.subidas.set('incapacidades/1/epicrisis-otro.pdf', PDF);
    const res = await receptor
      .post('/incapacidades/1/documentos')
      .type('form')
      .send({ subida_soporte_incapacidad: ajena, subida_epicrisis: 'incapacidades/1/epicrisis-otro.pdf' });
    expect(res.status).toBe(400);
    expect(baseDeDatos.documentos).toHaveLength(0);
    expect(baseDeDatos.subidas.has(ajena)).toBe(true); // no era suya: sigue ahí
    expect(baseDeDatos.subidas.has('incapacidades/1/epicrisis-otro.pdf')).toBe(true);
  });

  it('el formulario con archivos en la propia petición sigue funcionando (sin JavaScript)', async () => {
    const agente = await agenteCon(request, app, 'receptor');
    const res = await agente.post('/incapacidades/1/documentos').attach('soporte_incapacidad', PDF, 'soporte.pdf');
    expect(res.status).toBe(303);
    expect(baseDeDatos.documentos).toHaveLength(1);
  });

  it('la página marca el formulario para la subida directa', async () => {
    const agente = await agenteCon(request, app, 'receptor');
    expect((await agente.get('/incapacidades/1/documentos')).text).toContain('data-subida-directa');
  });
});

describe('registrar radicación con evidencia subida directo', () => {
  const radicar = (agente, cuerpo) => agente.post('/incapacidades/1/radicacion').type('form').send(cuerpo);

  it('registra con la referencia y borra lo pendiente', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const ruta = await subir(agente, PDF);
    const res = await radicar(agente, { radicado: 'NEPS-2026-118402', subida_evidencia: ruta });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/incapacidades/1/radicacion?registrada=1');
    expect(baseDeDatos.incapacidades[0].estado).toBe('transcrita');
    expect(baseDeDatos.subidas.size).toBe(0);
  });

  it('con evidencia inválida responde 400, conserva el radicado y borra lo pendiente', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const ruta = await subir(agente, Buffer.from('no es un pdf'));
    const res = await radicar(agente, { radicado: 'RAD-77', subida_evidencia: ruta });
    expect(res.status).toBe(400);
    expect(res.text).toContain('La evidencia debe ser PDF, JPG o PNG.');
    expect(res.text).toContain('value="RAD-77"');
    expect(baseDeDatos.incapacidades[0].estado).not.toBe('transcrita');
    expect(baseDeDatos.subidas.size).toBe(0);
  });

  it('un radicado demasiado largo se rechaza igual que en el formulario con archivo', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const ruta = await subir(agente, PDF);
    const res = await radicar(agente, { radicado: 'X'.repeat(200), subida_evidencia: ruta });
    expect(res.status).toBe(400);
    expect(res.text).toContain('El número de radicado admite máximo');
  });
});
