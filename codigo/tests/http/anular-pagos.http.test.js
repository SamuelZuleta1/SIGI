// Auditoría de las HU (pendientes) — anular un pago (HU-15) desde la línea de tiempo del cobro y un pago consignado
// (HU-25) desde «Registrados recientemente» (decisión 3A: desplegable en su sitio). Rutas con sesión y persistencia falsas.
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { formularioDeRegistro, PDF } from '../helpers/fabricas.js';
import { agenteCon, crearSesionFalsa, USUARIOS } from '../helpers/sesion-falsa.js';

const MOTIVO = 'Se digitó 1.250.000 y eran 125.000';
let app;
let baseDeDatos;
let control;

beforeEach(async () => {
  baseDeDatos = crearBaseDeDatosFalsa();
  control = crearControlIncapacidades({ baseDeDatos, correo: crearCorreoFalso().correo, hoy: () => '2026-11-21' });
  app = crearApp({ sesion: crearSesionFalsa(), control });
  await control.registrarIncapacidad(formularioDeRegistro({ entidad: '2' }), USUARIOS.receptor);
  await control.registrarRadicacion('1', { radicado: 'NEPS-2026-1', evidencia: PDF }, USUARIOS.auxiliar);
  await control.registrarCobrada('1', { tiempoPago: '30' });
  await control.registrarPago('1', { valor: '1.250.000', fechaPago: '2026-11-20' }, USUARIOS.auxiliar);
});

const anular = (agente, motivo = MOTIVO, idPago = 1) =>
  agente.post(`/incapacidades/1/pagos/${idPago}/anulacion`).type('form').send({ motivo });

describe('HU-15 (auditoría) — anular un pago (rutas)', () => {
  it('la línea de tiempo ofrece «Anular este pago» en el pago vigente sin conciliar', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/cobro');
    expect(res.text).toContain('<summary>Anular este pago</summary>');
    expect(res.text).toContain('action="/incapacidades/1/pagos/1/anulacion"');
    expect(res.text).toContain('Es el único vigente: la incapacidad vuelve a «cobrada».');
  });

  it('anula, redirige con la confirmación y lo deja tachado con quién, cuándo y el motivo', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await anular(agente);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/incapacidades/1/cobro?anulado=1');
    const pagina = await agente.get(res.headers.location);
    expect(pagina.text).toMatch(/anulado\.\s+Sin pagos vigentes, la incapacidad volvió a «cobrada»\./);
    expect(pagina.text).toMatch(/<li class="anulado/);
    expect(pagina.text).toContain('Pago anulado');
    expect(pagina.text).toMatch(new RegExp(`Anulado por auxiliar@sigi\\.test el \\d{1,2} \\w+ \\d{4}: «${MOTIVO.replaceAll('.', '\\.')}»`));
    expect(pagina.text).not.toContain('<summary>Anular este pago</summary>');
    expect(pagina.text).toContain('Esperando el pago'); // vuelve a pedir el pago correcto
  });

  it('motivo no válido: 400 y el desplegable de ese pago vuelve abierto con lo escrito', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await anular(agente, 'corto');
    expect(res.status).toBe(400);
    expect(res.text).toMatch(/<details class="otro-pago anular-pago" open>/);
    expect(res.text).toContain('Escriba el motivo con al menos 10 caracteres.');
    expect(res.text).toMatch(/<textarea id="motivo-1"[^>]*aria-invalid="true"[^>]*>corto<\/textarea>/);
    expect(baseDeDatos.pagos[0].anulacion).toBeUndefined();
  });

  it('conciliado: 409 con el motivo y no lo ofrece', async () => {
    baseDeDatos.pagos[0].conciliado = true;
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await anular(agente);
    expect(res.status).toBe(409);
    expect(res.text).toContain('ya se identificó en una conciliación');
    expect(res.text).not.toContain('<summary>Anular este pago</summary>');
  });

  it('una confirmación copiada de un pago que no está anulado no se muestra', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.get('/incapacidades/1/cobro?anulado=1')).text).not.toContain('anulado. ');
  });

  it.each(['receptor', 'lider', 'contabilidad', 'cartera'])('DA-02 — %s no puede anular un pago (403)', async (rol) => {
    const agente = await agenteCon(request, app, rol);
    expect((await anular(agente)).status).toBe(403);
    expect(baseDeDatos.pagos[0].anulacion).toBeUndefined();
  });

  it('sin sesión no se anula', async () => {
    expect((await anular(request(app))).status).toBe(401);
  });
});

describe('HU-25 (auditoría) — anular un pago consignado (rutas)', () => {
  beforeEach(async () => {
    await control.registrarPagosConsignados(
      { entidad: '2', colaborador: ['Ana Gómez', 'Luis Pérez'], dias: ['10', '3'], valor: ['1.250.000', '420.000'] },
      USUARIOS.contabilidad,
    );
  });
  const anularConsignado = (agente, motivo = MOTIVO, id = 1) => agente.post(`/pagos-consignados/${id}/anulacion`).type('form').send({ motivo });

  it('cada fila por identificar tiene su desplegable «Anular»', async () => {
    const agente = await agenteCon(request, app, 'contabilidad');
    const res = await agente.get('/pagos-consignados');
    expect(res.text.match(/<summary[^>]*>Anular<\/summary>/g)).toHaveLength(2);
    expect(res.text).toContain('action="/pagos-consignados/1/anulacion"');
  });

  it('anula, confirma y la fila queda tachada con el motivo', async () => {
    const agente = await agenteCon(request, app, 'contabilidad');
    const res = await anularConsignado(agente);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/pagos-consignados?anulado=1');
    const pagina = await agente.get(res.headers.location);
    expect(pagina.text).toContain('Ya no queda por identificar ni como saldo pendiente de Nueva EPS.');
    expect(pagina.text).toContain('<span class="chip rechazada">Anulado</span>');
    expect(pagina.text).toContain(`«${MOTIVO}»`);
    expect(pagina.text.match(/<summary[^>]*>Anular<\/summary>/g)).toHaveLength(1);
  });

  it('motivo no válido: 400 con el desplegable abierto; ya anulado: 409; no existe: 404', async () => {
    const agente = await agenteCon(request, app, 'contabilidad');
    const invalido = await anularConsignado(agente, '');
    expect(invalido.status).toBe(400);
    expect(invalido.text).toMatch(/<details class="otro-pago anular-pago" open>/);
    expect(invalido.text).toContain('Escriba por qué se anula.');
    await anularConsignado(agente);
    const repetido = await anularConsignado(agente);
    expect(repetido.status).toBe(409);
    expect(repetido.text).toContain('Este pago consignado ya está anulado.');
    expect((await anularConsignado(agente, MOTIVO, 99)).status).toBe(404);
  });

  it.each(['receptor', 'lider', 'auxiliar', 'cartera'])('DA-02 — %s no puede anular un pago consignado (403)', async (rol) => {
    const agente = await agenteCon(request, app, rol);
    expect((await anularConsignado(agente)).status).toBe(403);
    expect(baseDeDatos.pagosConsignados[0].anulacion).toBeUndefined();
  });
});
