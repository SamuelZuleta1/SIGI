// HU-27 — reporte de ausentismo (DS-12), rutas con sesión y persistencia falsa (DA-02, DA-21, DA-57).
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { crearApp } from '../../src/app.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso, DESTINATARIOS } from '../helpers/correo-falso.js';
import { agenteCon, crearSesionFalsa } from '../helpers/sesion-falsa.js';

let app;
let baseDeDatos;
let correo;
let enviados;

const crear = (c) => {
  app = crearApp({ sesion: crearSesionFalsa(), control: crearControlIncapacidades({ baseDeDatos, correo: c }) });
};

beforeEach(async () => {
  baseDeDatos = crearBaseDeDatosFalsa();
  ({ correo, enviados } = crearCorreoFalso());
  crear(correo);
  await baseDeDatos.guardarIncapacidad(
    { colaborador: { nombre: 'Ana <b>Gómez</b>', correo: 'ana@sigi.test' }, entidad: 2, tipo: 'enfermedad_general', fechaInicio: '2026-10-05', diasIncapacidad: 3, fechaRecepcion: '2026-10-06' },
    'id-receptor',
  );
  await baseDeDatos.guardarIncapacidad(
    { colaborador: { nombre: 'Luis Pérez', correo: 'luis@sigi.test' }, entidad: 1, tipo: 'accidente_laboral', fechaInicio: '2026-09-28', diasIncapacidad: 7, fechaRecepcion: '2026-09-29' },
    'id-receptor',
  );
});

const generar = (agente, periodo) => agente.post('/reportes/ausentismo').type('form').send({ periodo });

describe('HU-27 — reporte de ausentismo (rutas)', () => {
  it('el auxiliar ve el menú «Reportes», el mes anterior sugerido y que no hay reportes', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/reportes');
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="/reportes" aria-current="page"');
    expect(res.text).toMatch(/name="periodo" type="month" value="\d{4}-\d{2}" min="2020-01" max="\d{4}-\d{2}"/);
    expect(res.text).toContain('Aún no hay reportes de ausentismo.');
  });

  it('HU-27.CA1 — genera, guarda, envía al SG-SST y muestra el reporte', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await generar(agente, '2026-10');
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/reportes/1?generado=1');
    expect(baseDeDatos.reportes).toHaveLength(1);
    expect(enviados.map((m) => m.to)).toEqual([DESTINATARIOS.sgsst]);

    const reporte = await agente.get(res.headers.location);
    expect(reporte.status).toBe(200);
    expect(reporte.text).toContain('Reporte guardado y enviado al SG-SST: <strong>2</strong> incapacidades del periodo 2026-10.');
    expect(reporte.text).toContain('7 días'); // 3 de Ana + 4 de Luis en octubre
    expect(reporte.text).toContain('Accidente laboral');
    expect(reporte.text).toContain('Ana &lt;b&gt;Gómez&lt;/b&gt;');
    expect(reporte.text).not.toContain('<b>Gómez</b>');
    expect(reporte.text).toContain('href="/reportes" aria-current="page"');

    const lista = await agente.get('/reportes');
    expect(lista.text).toContain('href="/reportes/1"');
  });

  it('sin ?generado=1 no muestra la confirmación', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    await generar(agente, '2026-10');
    const res = await agente.get('/reportes/1');
    expect(res.text).not.toContain('Reporte guardado y enviado');
  });

  it.each([
    ['2026-13', 'Escriba el mes como AAAA-MM, por ejemplo 2026-10.'],
    ['2999-01', 'El mes del reporte no puede ser futuro.'],
    ['2026-08', 'No hay incapacidades en 2026-08: no se generó el reporte.'],
  ])('«%s» vuelve con el error (400) y no guarda ni envía', async (periodo, mensaje) => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await generar(agente, periodo);
    expect(res.status).toBe(400);
    expect(res.text).toContain(mensaje);
    expect(res.text).toContain(`value="${periodo}"`);
    expect(res.text).toContain('href="/reportes" aria-current="page"');
    expect(baseDeDatos.reportes).toHaveLength(0);
    expect(enviados).toHaveLength(0);
  });

  it('si el correo al SG-SST falla y se deshace: 502, sin reporte guardado', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    crear({ ...correo, enviarReporteAusentismo: async () => { throw new Error('SMTP caído'); } });
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await generar(agente, '2026-10');
    expect(res.status).toBe(502);
    expect(res.text).toContain('No se pudo avisar al SG-SST; no se guardó nada.');
    expect(baseDeDatos.reportes).toHaveLength(0);
  });

  it('si además no se puede deshacer: 500 con el aviso de revisar', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    baseDeDatos.eliminarReporte = async () => { throw new Error('BD caída'); };
    crear({ ...correo, enviarReporteAusentismo: async () => { throw new Error('SMTP caído'); } });
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await generar(agente, '2026-10');
    expect(res.status).toBe(500);
    expect(res.text).toContain('pudo quedar guardado sin enviarse');
  });

  it.each(['abc', '0', '99'])('un reporte que no existe (%s) da 404', async (id) => {
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.get(`/reportes/${id}`)).status).toBe(404);
  });

  it.each(['receptor', 'lider', 'contabilidad', 'cartera'])('DA-02 — %s no puede generar ni ver reportes (403)', async (rol) => {
    const agente = await agenteCon(request, app, rol);
    expect((await agente.get('/reportes')).status).toBe(403);
    expect((await generar(agente, '2026-10')).status).toBe(403);
    expect((await agente.get('/')).text).not.toContain('href="/reportes"');
    expect(baseDeDatos.reportes).toHaveLength(0);
  });

  it('HU-01 — sin sesión, el reporte se rechaza', async () => {
    const res = await request(app).post('/reportes/ausentismo').type('form').send({ periodo: '2026-10' });
    expect(res.status).toBe(401);
    expect(baseDeDatos.reportes).toHaveLength(0);
  });
});
