// HU-26 — identificar los pagos y conciliar (DS-11), rutas con sesión y persistencia falsa (DA-02, DA-11, DA-56).
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { crearApp } from '../../src/app.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { pagoRegistrado } from '../helpers/fabricas.js';
import { agenteCon, crearSesionFalsa } from '../helpers/sesion-falsa.js';

let app;
let baseDeDatos;
let correo;
let enviados;
let pagoAna;
let pagoLuis;

beforeEach(async () => {
  baseDeDatos = crearBaseDeDatosFalsa();
  ({ correo, enviados } = crearCorreoFalso());
  app = crearApp({ sesion: crearSesionFalsa(), control: crearControlIncapacidades({ baseDeDatos, correo }) });
  await baseDeDatos.guardarPagosConsignados(2, [
    { colaborador: 'Ana Gómez', diasPagados: 10, valor: '1250000.00' },
    { colaborador: 'Luis Pérez', diasPagados: 3, valor: '420000.50' },
  ], 'id-contabilidad');
  pagoAna = await pagoRegistrado(baseDeDatos, { colaborador: 'Ana Gómez', valor: '1250000.00' });
  pagoLuis = await pagoRegistrado(baseDeDatos, { colaborador: 'Luis Pérez', valor: '420000.50' });
});

const conciliar = (agente, datos) => agente.post('/conciliacion').type('form').send(datos);

describe('HU-26 — conciliación (rutas)', () => {
  it('el auxiliar ve el menú «Conciliación» y las entidades con cuántos pagos tienen por identificar', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/conciliacion');
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="/conciliacion" aria-current="page"');
    expect(res.text).toContain('Nueva EPS — 2 por identificar');
    expect(res.text).toContain('Elija la entidad que va a conciliar.');
    expect(res.text).toContain('Aún no hay conciliaciones.');
  });

  it('HU-26.CA1 — al elegir la entidad muestra sus consignados y los pagos registrados, marcados y comparados', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/conciliacion?entidad=2');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Consignados por identificar');
    expect(res.text).toContain('$ 1.670.000,50');
    expect(res.text.match(/name="pagos" value="\d+" checked/g)).toHaveLength(2);
    expect(res.text.match(/chip coincide">Coincide/g)).toHaveLength(4);
    expect(res.text).toContain('Los 2 pagos consignados tienen su pago registrado.');
  });

  it.each(['receptor', 'lider', 'contabilidad', 'cartera'])('DA-02 — %s no puede conciliar (403)', async (rol) => {
    const agente = await agenteCon(request, app, rol);
    expect((await agente.get('/conciliacion')).status).toBe(403);
    expect((await conciliar(agente, { entidad: '2', pagos: [String(pagoAna)] })).status).toBe(403);
    expect((await agente.get('/')).text).not.toContain('href="/conciliacion"');
    expect(baseDeDatos.conciliaciones).toHaveLength(0);
  });

  it('HU-01 — sin sesión, la conciliación se rechaza', async () => {
    const res = await request(app).post('/conciliacion').type('form').send({ entidad: '2' });
    expect(res.status).toBe(401);
    expect(baseDeDatos.conciliaciones).toHaveLength(0);
  });

  it('HU-26.CA2 — todo identificado: guarda, envía el detalle y muestra la confirmación', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await conciliar(agente, { entidad: '2', pagos: [String(pagoAna), String(pagoLuis)] });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/conciliacion/1?registrada=1');
    expect(enviados.map((m) => m.subject)).toEqual(['[SIGI] Detalle conciliado — Nueva EPS']);
    const pagina = await agente.get(res.headers.location);
    expect(pagina.status).toBe(200);
    expect(pagina.text).toContain('los <strong>2</strong> pagos consignados quedaron identificados y conciliados');
    expect(pagina.text).toContain('Se envió el detalle conciliado a Contabilidad y Tesorería.');
    expect(pagina.text).toContain('Detalle conciliado');
    expect(pagina.text).toContain('href="/conciliacion" aria-current="page"');
    // Sin ?registrada la conciliación se puede volver a ver, sin repetir la confirmación.
    expect((await agente.get('/conciliacion/1')).text).not.toContain('Se envió el detalle');
  });

  it('B5 — con varios saldos, en plural: «Quedaron 2 saldos … Se guardaron y se notificaron»', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await conciliar(agente, { entidad: '2' }); // ningún pago elegido: los 2 consignados quedan sin identificar
    expect(res.status).toBe(303);
    const pagina = await agente.get(res.headers.location);
    expect(pagina.text).toContain('Quedaron <strong>2</strong> saldos sin identificar. Se guardaron y se notificaron a Contabilidad y Tesorería.');
  });

  it('HU-26.CA3 — quedan saldos: los muestra al auxiliar y los notifica', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await conciliar(agente, { entidad: '2', pagos: String(pagoAna) });
    expect(res.status).toBe(303);
    expect(enviados.map((m) => m.subject)).toEqual(['[SIGI] Saldos pendientes por identificar — Nueva EPS']);
    const pagina = await agente.get(res.headers.location);
    // B5: en singular, verbo y sustantivo concuerdan.
    expect(pagina.text).toContain('Quedó <strong>1</strong> saldo sin identificar. Se guardó y se notificó a Contabilidad y Tesorería.');
    expect(pagina.text).not.toContain('Quedaron <strong>1</strong>');
    expect(pagina.text).toContain('Saldos pendientes');
    expect(pagina.text).toContain('Luis Pérez');
    expect(pagina.text).toContain('$ 420.000,50');
  });

  it('sin consignados por identificar: 400 con el mensaje junto a la entidad', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await conciliar(agente, { entidad: '3' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('Sanitas no tiene pagos consignados por identificar.');
    expect(baseDeDatos.conciliaciones).toHaveLength(0);
  });

  it('un pago que ya no está disponible: 409 y vuelve a mostrar la lista', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await conciliar(agente, { entidad: '2', pagos: ['9999'] });
    expect(res.status).toBe(409);
    expect(res.text).toContain('Uno de los pagos elegidos ya se concilió o no es de esta entidad.');
    expect(res.text).toContain('Consignados por identificar');
  });

  it('el correo falla y se deshizo: 502 y conserva la selección', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    correo.notificarSaldosPendientes = async () => { throw new Error('SMTP caído'); };
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await conciliar(agente, { entidad: '2', pagos: String(pagoAna) });
    expect(res.status).toBe(502);
    expect(res.text).toContain('No se pudo avisar a Contabilidad y Tesorería; no se guardó nada.');
    expect(res.text).toContain(`value="${pagoAna}" checked`);
    expect(res.text).not.toContain(`value="${pagoLuis}" checked`);
    expect(baseDeDatos.conciliaciones).toHaveLength(0);
  });

  it('el correo falla y no se pudo deshacer: 500 y dice que pudo quedar guardada', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    correo.enviarDetalleConciliado = async () => { throw new Error('SMTP caído'); };
    baseDeDatos.deshacerConciliacion = async () => { throw new Error('sin conexión'); };
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await conciliar(agente, { entidad: '2', pagos: [String(pagoAna), String(pagoLuis)] });
    expect(res.status).toBe(500);
    expect(res.text).toContain('pudo quedar guardada sin aviso');
  });

  it('una conciliación que no existe: 404', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.get('/conciliacion/77')).status).toBe(404);
    expect((await agente.get('/conciliacion/abc')).status).toBe(404);
  });
});
