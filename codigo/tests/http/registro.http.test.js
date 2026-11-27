// Rutas del grupo `registro` (DS-01, CU-01) con sesión y persistencia falsas.
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { formularioDeRegistro } from '../helpers/fabricas.js';
import { agenteCon, crearSesionFalsa } from '../helpers/sesion-falsa.js';

let app;
let baseDeDatos;

beforeEach(() => {
  baseDeDatos = crearBaseDeDatosFalsa();
  // Hoy fijo: las reglas de fechas de HU-03 dependen de él (recepción no futura, inicio de hasta 3 años atrás).
  app = crearApp({ sesion: crearSesionFalsa(), control: crearControlIncapacidades({ baseDeDatos, hoy: () => '2026-11-25' }) });
});

const registrar = (agente, cambios) => agente.post('/incapacidades').type('form').send(formularioDeRegistro(cambios));

describe('HU-03 — registrar incapacidad o licencia (rutas)', () => {
  it.each([
    ['HU-03.CA1', 'receptor'],
    ['HU-03.CA2', 'auxiliar'],
  ])('%s — el %s registra, recibe el identificador y ve la confirmación', async (_ca, rol) => {
    const agente = await agenteCon(request, app, rol);
    const res = await registrar(agente);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/incapacidades/nueva?registrada=1');
    expect(baseDeDatos.incapacidades).toHaveLength(1);
    expect(baseDeDatos.incapacidades[0].creadoPor).toBe(`id-${rol}`);

    const confirmacion = await agente.get(res.headers.location);
    expect(confirmacion.status).toBe(200);
    expect(confirmacion.text).toMatch(/Incapacidad n\.º <strong>1<\/strong> registrada/);
  });

  it.each(['receptor', 'auxiliar'])('HU-03.CA1 — el %s ve el formulario con los 6 datos, los 6 tipos y las entidades', async (rol) => {
    const agente = await agenteCon(request, app, rol);
    const res = await agente.get('/incapacidades/nueva');
    expect(res.status).toBe(200);
    for (const campo of ['colaborador', 'tipo', 'entidad', 'fechaInicio', 'diasIncapacidad', 'fechaRecepcion']) {
      expect(res.text).toContain(`name="${campo}"`);
    }
    expect(res.text.match(/<option value="[a-z_]+"/g)).toHaveLength(6);
    expect(res.text).toContain('Nueva EPS');
    expect(res.text).toContain('href="/incapacidades/nueva" aria-current="page"');
  });

  it('HU-03.CA3 — un tipo fuera de los 6 responde 400, no guarda y conserva lo escrito', async () => {
    const agente = await agenteCon(request, app, 'receptor');
    const res = await registrar(agente, { tipo: 'vacaciones', colaborador: 'Luis <b>Pérez</b>' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('Elija el tipo de incapacidad o licencia.');
    expect(res.text).toContain('value="Luis &lt;b&gt;Pérez&lt;/b&gt;"');
    expect(baseDeDatos.incapacidades).toHaveLength(0);
  });

  it('HU-21.CA3 — el formulario de registro no pide el IBC', async () => {
    const agente = await agenteCon(request, app, 'receptor');
    expect((await agente.get('/incapacidades/nueva')).text).not.toMatch(/ibc/i);
  });

  it.each(['lider', 'contabilidad', 'cartera'])('DA-02 — el rol %s no puede registrar ni ve la opción en el menú', async (rol) => {
    const agente = await agenteCon(request, app, rol);
    expect((await agente.get('/incapacidades/nueva')).status).toBe(403);
    expect((await registrar(agente)).status).toBe(403);
    expect((await agente.get('/').redirects(1)).text).not.toContain('/incapacidades/nueva');
    expect(baseDeDatos.incapacidades).toHaveLength(0);
  });

  it('HU-01.CA3 — sin sesión no se registra', async () => {
    expect((await registrar(request(app))).status).toBe(401);
    expect((await request(app).get('/incapacidades/nueva')).headers.location).toBe('/iniciar-sesion');
    expect(baseDeDatos.incapacidades).toHaveLength(0);
  });

  it('la confirmación solo acepta un identificador numérico', async () => {
    const agente = await agenteCon(request, app, 'receptor');
    const res = await agente.get('/incapacidades/nueva?registrada=%3Cscript%3E');
    expect(res.text).not.toContain('registrada.');
    expect(res.text).not.toMatch(/<script>/i);
  });
});

describe('HU-03 y HU-12 (auditoría) — validaciones del registro (rutas)', () => {
  it('HU-12 — el formulario trae la fecha de nacimiento, con hoy como máximo en ella y en la recepción', async () => {
    const agente = await agenteCon(request, app, 'receptor');
    const res = await agente.get('/incapacidades/nueva');
    expect(res.text).toContain('name="fechaNacimiento"');
    expect(res.text).toContain('data-nacimiento');
    expect(res.text).toMatch(/name="fechaRecepcion"[^>]*max="\d{4}-\d{2}-\d{2}"/);
    expect(res.text).toMatch(/name="fechaNacimiento"[^>]*max="\d{4}-\d{2}-\d{2}"/);
  });

  it('HU-12 — una licencia de paternidad guarda la fecha de nacimiento escrita', async () => {
    const agente = await agenteCon(request, app, 'receptor');
    const res = await registrar(agente, { tipo: 'licencia_paternidad', fechaInicio: '2026-11-05', fechaNacimiento: '2026-11-01' });
    expect(res.status).toBe(303);
    expect(baseDeDatos.incapacidades[0].fechaNacimiento).toBe('2026-11-01');
  });

  it('HU-12 — una licencia sin fecha de nacimiento responde 400 y señala el campo', async () => {
    const agente = await agenteCon(request, app, 'receptor');
    const res = await registrar(agente, { tipo: 'licencia_maternidad', fechaNacimiento: '' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('id="error-fechaNacimiento"');
    expect(baseDeDatos.incapacidades).toHaveLength(0);
  });

  it('HU-03 — la recepción futura y el tipo laboral ante una EPS responden 400 en su campo', async () => {
    const agente = await agenteCon(request, app, 'receptor');
    const res = await registrar(agente, { fechaInicio: '2026-11-03', fechaRecepcion: '2099-01-01', tipo: 'accidente_laboral', entidad: '2' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('La fecha de recepción no puede ser posterior a hoy.');
    expect(res.text).toContain('se tramita ante la ARL');
    expect(baseDeDatos.incapacidades).toHaveLength(0);
  });

  it('HU-03 — un duplicado responde 400 con el número de la que ya existe', async () => {
    const agente = await agenteCon(request, app, 'receptor');
    await registrar(agente);
    const res = await registrar(agente);
    expect(res.status).toBe(400);
    expect(res.text).toContain('Ya está registrada la incapacidad n.º 1 de este colaborador');
    expect(baseDeDatos.incapacidades).toHaveLength(1);
  });

  it('HU-03 (decisión 1A) — nombre distinto: pide confirmar con la casilla y, marcada, registra con el guardado', async () => {
    const agente = await agenteCon(request, app, 'receptor');
    await registrar(agente, { colaborador: 'Ana María Gómez Ríos', fechaInicio: '2026-10-01' });
    const res = await registrar(agente, { colaborador: 'Ana Gómez' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('Ese correo ya es de «Ana María Gómez Ríos»');
    expect(res.text).toContain('name="usarNombreGuardado"');
    expect(res.text).toContain('value="Ana Gómez"'); // lo escrito se conserva

    const confirmado = await registrar(agente, { colaborador: 'Ana Gómez', usarNombreGuardado: 'si' });
    expect(confirmado.status).toBe(303);
    expect(baseDeDatos.colaboradores.map((c) => c.nombre)).toEqual(['Ana María Gómez Ríos']);
  });

  it('sin el conflicto de nombre no aparece la casilla', async () => {
    const agente = await agenteCon(request, app, 'receptor');
    const res = await registrar(agente, { tipo: 'vacaciones' });
    expect(res.text).not.toContain('name="usarNombreGuardado"');
  });
});
