// HU-12 — ver las alertas de plazos (DS-14, CU-09), con sesión y persistencia falsas.
// Diseño: opción B «filtro por tipo de plazo + dos tablas apiladas». Solo lectura (GET).
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { ROLES } from '../../src/models/usuario.model.js';
import { enlaceAlerta } from '../../src/routes/alertas.routes.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { formularioDeRegistro } from '../helpers/fabricas.js';
import { agenteCon, crearSesionFalsa, USUARIOS } from '../helpers/sesion-falsa.js';

let app;
let baseDeDatos;
let control;

const registrar = async (cambios, extra = {}) => {
  const { idIncapacidad } = await control.registrarIncapacidad(formularioDeRegistro(cambios), USUARIOS.receptor);
  Object.assign(baseDeDatos.incapacidades.find((i) => i.idIncapacidad === idIncapacidad), extra);
};

const preparar = () => {
  baseDeDatos = crearBaseDeDatosFalsa();
  control = crearControlIncapacidades({ baseDeDatos, correo: crearCorreoFalso().correo, hoy: () => '2026-11-19' });
  app = crearApp({ sesion: crearSesionFalsa(), control });
};

describe('HU-12 — alertas de plazos (rutas)', () => {
  // 1 subsanación vencida (Jorge, nombre con HTML) · 2 transcripción por vencer · 3 hito 90 por vencer
  beforeEach(async () => {
    preparar();
    await registrar(
      { colaborador: 'Jorge <b>Cardona</b>', correoColaborador: 'jorge@sigi.test' },
      { documentacionCompleta: false, fechaAvisoFaltantes: '2026-11-12' },
    );
    await registrar({ fechaInicio: '2025-11-21', fechaRecepcion: '2025-11-22' });
    await registrar({ fechaInicio: '2026-08-24', fechaRecepcion: '2026-08-25', diasIncapacidad: '120' }, { estado: 'transcrita' });
  });

  it('HU-12.CA1 — muestra separados los vencidos y los por vencer, con enlace a donde se actúa', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/alertas');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Calculadas hoy, jueves 19 de noviembre de 2026.');
    const [vencidos, porVencer] = res.text.split('id="titulo-por_vencer"');
    expect(vencidos).toMatch(/Vencidos<span class="n"><span class="oculto">: <\/span>1<\/span>/);
    expect(vencidos).toContain('Subsanación de documentos<small>3 días hábiles desde el aviso</small>');
    expect(vencidos).toContain('Venció hace 1 día<small>Ya se puede registrar el segundo llamado</small>');
    expect(vencidos).toContain('href="/incapacidades/1/verificacion"');
    expect(porVencer).toMatch(/Por vencer<span class="n"><span class="oculto">: <\/span>2<\/span>/);
    expect(porVencer).toContain('Transcripción<small>12 meses desde el inicio</small>');
    expect(porVencer).toContain('Quedan 2 días<small>Sin radicar</small>');
    expect(porVencer).toContain('href="/incapacidades/2/radicacion"');
    expect(porVencer).toContain('Hito de 90 días<small>Día 90 de incapacidad</small>');
    expect(porVencer).toContain('Se cumple en 2 días');
    expect(porVencer).toContain('21 nov 2026');
    // HU-12.CA2: solo informa; no hay formularios ni botones de acción.
    expect(res.text.split('id="contenido"')[1]).not.toContain('<form');
    // El menú lateral marca la página.
    expect(res.text).toMatch(/href="\/alertas" aria-current="page">\s*<svg/);
  });

  it('HU-12.CA1 — el filtro por tipo marca el escogido, conserva los conteos y deja los tipos sin alertas sin enlace', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/alertas?tipo=hito90');
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="/alertas?tipo=hito90" aria-current="page">90 días <span class="n"><span class="oculto">: </span>1</span>');
    expect(res.text).toContain('href="/alertas">Todos <span class="n"><span class="oculto">: </span>3</span>');
    expect(res.text).toContain('<span class="sin-alertas">Envío de la incapacidad <span class="n"><span class="oculto">: </span>0</span></span>');
    expect(res.text).toContain('Ningún plazo vencido de este tipo.');
    expect(res.text).not.toContain('href="/incapacidades/2/radicacion"');
    expect(res.text).toContain('href="/incapacidades/3/radicacion"');
  });

  it('seguridad — el nombre del colaborador se escapa', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/alertas?tipo=%3Cscript%3E');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Jorge &lt;b&gt;Cardona&lt;/b&gt;');
    expect(res.text).not.toContain('<script>');
  });

  it('HU-12.CA2 — la consulta no modifica datos: solo responde a GET', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const antes = structuredClone(baseDeDatos.incapacidades);
    expect((await agente.post('/alertas')).status).toBe(404);
    await agente.get('/alertas');
    expect(baseDeDatos.incapacidades).toEqual(antes);
  });

  it.each(ROLES.filter((r) => r !== 'auxiliar'))('DA-02 — el rol %s no consulta alertas: 403 y sin enlace en el menú', async (rol) => {
    const agente = await agenteCon(request, app, rol);
    expect((await agente.get('/alertas')).status).toBe(403);
    expect((await agente.get('/').redirects(1)).text).not.toContain('href="/alertas"');
  });

  it('HU-01 — sin sesión: lleva a iniciar sesión', async () => {
    const res = await request(app).get('/alertas');
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/iniciar-sesion/);
  });
});

describe('HU-12 — sin alertas', () => {
  beforeEach(async () => {
    preparar();
    await registrar({});
  });

  it('HU-12.CA1 — lo dice en las dos secciones', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/alertas');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Ningún plazo vencido.');
    expect(res.text).toContain('Ningún plazo por vencer.');
  });
});

describe('enlaceAlerta', () => {
  it('lleva la subsanación y el envío a la verificación; lo demás a la radicación', () => {
    expect(enlaceAlerta({ tipo: 'subsanacion', idIncapacidad: 4 })).toBe('/incapacidades/4/verificacion');
    expect(enlaceAlerta({ tipo: 'envio', idIncapacidad: 4 })).toBe('/incapacidades/4/verificacion');
    expect(enlaceAlerta({ tipo: 'paternidad', idIncapacidad: 4 })).toBe('/incapacidades/4/radicacion');
    expect(enlaceAlerta({ tipo: 'hito180', idIncapacidad: 4 })).toBe('/incapacidades/4/radicacion');
  });
});
