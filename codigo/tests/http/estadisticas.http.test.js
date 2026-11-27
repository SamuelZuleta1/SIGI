// Estadísticas e informes — rutas con sesión y persistencia falsa (DA-02: solo el auxiliar).
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { hoyEnColombia } from '../../src/servicios/dias-habiles.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { agenteCon, crearSesionFalsa } from '../helpers/sesion-falsa.js';

let app;
let baseDeDatos;
const MES = hoyEnColombia().slice(0, 7);
const DIA = `${MES}-01`;

beforeEach(async () => {
  baseDeDatos = crearBaseDeDatosFalsa();
  const { correo } = crearCorreoFalso();
  app = crearApp({ sesion: crearSesionFalsa(), control: crearControlIncapacidades({ baseDeDatos, correo }) });
  const ana = await baseDeDatos.guardarIncapacidad(
    { colaborador: { nombre: 'Ana <b>Gómez</b>', correo: 'ana@sigi.test' }, entidad: 2, tipo: 'enfermedad_general', fechaInicio: DIA, diasIncapacidad: 1, fechaRecepcion: DIA },
    'id-receptor',
  );
  Object.assign(baseDeDatos.incapacidades[ana - 1], { estado: 'pagada', fechaCobrada: DIA, tiempoPago: 30 });
  baseDeDatos.pagos.push({ idPago: 1, idIncapacidad: ana, valor: '1234567.00', fechaPago: DIA, conciliado: false });
  const luis = await baseDeDatos.guardarIncapacidad(
    { colaborador: { nombre: '=Luis Pérez', correo: 'luis@sigi.test' }, entidad: 1, tipo: 'accidente_laboral', fechaInicio: DIA, diasIncapacidad: 1, fechaRecepcion: DIA },
    'id-receptor',
  );
  Object.assign(baseDeDatos.incapacidades[luis - 1], { estado: 'cobrada', fechaCobrada: DIA, tiempoPago: 30 });
});

describe('Estadísticas (rutas)', () => {
  it('el auxiliar ve el menú y el panel con los indicadores del mes en curso', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get(`/estadisticas?desde=${MES}&hasta=${MES}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="/estadisticas" aria-current="page"');
    expect(res.text).toContain('href="/informes"');
    expect(res.text).toContain('Evolución mensual');
    expect(res.text).toContain('$\u00a01.234.567');
    expect(res.text).toContain('Ana &lt;b&gt;Gómez&lt;/b&gt;');
    expect(res.text).not.toContain('<b>Gómez</b>');
    expect(res.text).not.toMatch(/style="/); // la CSP no permite estilos en línea
  });

  it('sin filtros usa el rango por defecto (200)', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/estadisticas');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Últimos 6 meses</a>');
  });

  it('un rango no válido vuelve con el error (400) y sin tablero', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/estadisticas?desde=2026-05&hasta=2026-04');
    expect(res.status).toBe(400);
    expect(res.text).toContain('Debe ser igual o posterior al mes inicial.');
    expect(res.text).not.toContain('Evolución mensual');
  });
});

describe('Informes (rutas)', () => {
  it('muestra el formulario con los cuatro informes', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/informes');
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="/informes" aria-current="page"');
    for (const nombre of ['Informe de gestión', 'Detalle de incapacidades', 'Recaudo por entidad', 'Cartera pendiente']) expect(res.text).toContain(nombre);
  });

  it('genera el informe de gestión en pantalla, con imprimir y descargar CSV', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get(`/informes/generar?tipo=gestion&desde=${MES}&hasta=${MES}`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toContain('data-imprimir');
    expect(res.text).toContain(`href="/informes/generar?tipo=gestion&amp;desde=${MES}&amp;hasta=${MES}&amp;formato=csv"`);
    expect(res.text).toContain('Resumen');
    expect(res.text).toContain('href="/informes" aria-current="page"');
  });

  it('descarga el detalle en CSV para Excel, sin fórmulas', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get(`/informes/generar?tipo=detalle&desde=${MES}&hasta=${MES}&formato=csv`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="sigi-detalle-${MES}_${MES}.csv"`);
    expect(res.text.startsWith('\uFEFFSIGI;Detalle de incapacidades')).toBe(true);
    expect(res.text).toContain("'=Luis Pérez");
    expect(res.text).not.toMatch(/;=Luis/);
  });

  it('la cartera pendiente lista las cobradas sin pago', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/informes/generar?tipo=cartera');
    expect(res.status).toBe(200);
    expect(res.text).toContain('=Luis Pérez');
    expect(res.text).toContain('Cobradas sin pago');
  });

  it('un informe desconocido vuelve al formulario con el error (400)', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get(`/informes/generar?tipo=otro&desde=${MES}&hasta=${MES}`);
    expect(res.status).toBe(400);
    expect(res.text).toContain('Elija el informe que quiere generar.');
  });
});

describe('DA-02 — solo el auxiliar', () => {
  it.each(['receptor', 'lider', 'contabilidad', 'cartera'])('%s no ve ni genera estadísticas o informes (403)', async (rol) => {
    const agente = await agenteCon(request, app, rol);
    expect((await agente.get('/estadisticas')).status).toBe(403);
    expect((await agente.get('/informes')).status).toBe(403);
    expect((await agente.get('/informes/generar?tipo=gestion&formato=csv')).status).toBe(403);
    const inicio = await agente.get('/').redirects(1);
    expect(inicio.text).not.toContain('href="/estadisticas"');
    expect(inicio.text).not.toContain('href="/informes"');
  });
});
