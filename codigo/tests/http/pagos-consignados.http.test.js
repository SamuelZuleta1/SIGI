// HU-25 — registrar los pagos consignados (DS-11), rutas con sesión y persistencia falsa (DA-02, DA-55).
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { crearApp } from '../../src/app.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { agenteCon, crearSesionFalsa } from '../helpers/sesion-falsa.js';

let app;
let baseDeDatos;
let correo;
let enviados;

const LISTA = { entidad: '2', colaborador: ['Ana Gómez', 'Luis Pérez'], dias: ['10', '3'], valor: ['1.250.000', '420.000,50'] };
const enviar = (agente, datos) => agente.post('/pagos-consignados').type('form').send(datos);

beforeEach(() => {
  baseDeDatos = crearBaseDeDatosFalsa();
  ({ correo, enviados } = crearCorreoFalso());
  app = crearApp({ sesion: crearSesionFalsa(), control: crearControlIncapacidades({ baseDeDatos, correo }) });
});

describe('HU-25 — pagos consignados (rutas)', () => {
  it('Contabilidad ve el menú «Pagos consignados» y el formulario con 5 filas', async () => {
    const agente = await agenteCon(request, app, 'contabilidad');
    const res = await agente.get('/pagos-consignados');
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="/pagos-consignados" aria-current="page"');
    expect(res.text.match(/name="colaborador"/g)).toHaveLength(5);
    expect(res.text).toContain('Nueva EPS (EPS)');
    expect(res.text).toContain('Aún no hay pagos consignados registrados.');
  });

  it.each(['receptor', 'lider', 'auxiliar', 'cartera'])('DA-02 — %s no puede registrar pagos consignados (403)', async (rol) => {
    const agente = await agenteCon(request, app, rol);
    expect((await agente.get('/pagos-consignados')).status).toBe(403);
    expect((await enviar(agente, LISTA)).status).toBe(403);
    expect(baseDeDatos.pagosConsignados).toHaveLength(0);
    expect((await agente.get('/').redirects(1)).text).not.toContain('href="/pagos-consignados"');
  });

  it('HU-01 — sin sesión, el registro se rechaza', async () => {
    const res = await request(app).post('/pagos-consignados').type('form').send(LISTA);
    expect(res.status).toBe(401);
    expect(baseDeDatos.pagosConsignados).toHaveLength(0);
  });

  it('HU-25.CA1 — guarda la lista, avisa al auxiliar y muestra la confirmación', async () => {
    const agente = await agenteCon(request, app, 'contabilidad');
    const res = await enviar(agente, LISTA);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/pagos-consignados?registrados=2&entidad=2');
    expect(baseDeDatos.pagosConsignados).toHaveLength(2);
    expect(enviados).toHaveLength(1);
    const pagina = await agente.get(res.headers.location);
    expect(pagina.text).toContain('Se registraron <strong>2</strong> pagos de Nueva EPS');
    expect(pagina.text).toContain('$ 1.670.000,50');
    expect(pagina.text).toContain('Se avisó al auxiliar');
    expect(pagina.text).toContain('Luis Pérez');
    expect(pagina.text).toContain('$ 420.000,50');
  });

  it('un enlace copiado con ?registrados que no coincide no muestra la confirmación', async () => {
    const agente = await agenteCon(request, app, 'contabilidad');
    expect((await agente.get('/pagos-consignados?registrados=3&entidad=2')).text).not.toContain('Se registraron');
  });

  it('datos no válidos: 400, marca la fila y conserva lo escrito', async () => {
    const agente = await agenteCon(request, app, 'contabilidad');
    const res = await enviar(agente, { ...LISTA, dias: ['10', 'tres'] });
    expect(res.status).toBe(400);
    expect(res.text).toContain('Revise las filas marcadas: no se guardó ningún pago.');
    expect(res.text).toContain('id="error-fila-1-dias"');
    expect(res.text).toContain('value="tres"');
    expect(res.text).toContain('value="Ana Gómez"');
    expect(res.text).toMatch(/<option value="2" selected>/);
    expect(baseDeDatos.pagosConsignados).toHaveLength(0);
    expect(enviados).toHaveLength(0);
  });

  it('«Agregar filas» vuelve a mostrar el formulario con 5 filas más, sin guardar', async () => {
    const agente = await agenteCon(request, app, 'contabilidad');
    const res = await enviar(agente, { ...LISTA, accion: 'agregar-filas' });
    expect(res.status).toBe(200);
    expect(res.text.match(/name="colaborador"/g)).toHaveLength(7);
    expect(res.text).toContain('value="Luis Pérez"');
    expect(baseDeDatos.pagosConsignados).toHaveLength(0);
    expect(enviados).toHaveLength(0);
  });

  it('el correo falla y se deshizo: 502, no queda nada y conserva lo escrito', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    correo.notificarPagosPorIdentificar = async () => { throw new Error('SMTP caído'); };
    const agente = await agenteCon(request, app, 'contabilidad');
    const res = await enviar(agente, LISTA);
    expect(res.status).toBe(502);
    expect(res.text).toContain('No se pudo avisar al auxiliar; no se guardó nada.');
    expect(res.text).toContain('value="Ana Gómez"');
    expect(baseDeDatos.pagosConsignados).toHaveLength(0);
  });

  it('el correo falla y no se pudo deshacer: 500 y dice que pudo quedar guardado', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    correo.notificarPagosPorIdentificar = async () => { throw new Error('SMTP caído'); };
    baseDeDatos.eliminarPagosConsignados = async () => { throw new Error('sin conexión'); };
    const agente = await agenteCon(request, app, 'contabilidad');
    const res = await enviar(agente, LISTA);
    expect(res.status).toBe(500);
    expect(res.text).toContain('pudieron quedar guardados sin aviso');
  });
});
