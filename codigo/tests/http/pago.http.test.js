// HU-15 — registrar el pago (DS-06), rutas con sesión y persistencia falsas. Diseño: último paso de la línea de
// tiempo del cobro (DA-40). HU-15.CA2: una sola ruta (y una sola operación del Control) para todos los orígenes.
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { crearApp } from '../../src/app.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { ORIGENES_PAGO } from '../../src/routes/cobro.routes.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { formularioDeRegistro, PDF } from '../helpers/fabricas.js';
import { agenteCon, crearSesionFalsa, USUARIOS } from '../helpers/sesion-falsa.js';

let app;
let baseDeDatos;
let control;

beforeEach(async () => {
  baseDeDatos = crearBaseDeDatosFalsa();
  control = crearControlIncapacidades({ baseDeDatos, correo: crearCorreoFalso().correo, hoy: () => '2026-11-21' });
  app = crearApp({ sesion: crearSesionFalsa(), control });
  await control.registrarIncapacidad(formularioDeRegistro({ entidad: '2' }), USUARIOS.receptor);
});

const cobrar = async () => {
  await control.registrarRadicacion('1', { radicado: 'NEPS-2026-118402', evidencia: PDF }, USUARIOS.auxiliar);
  await control.registrarCobrada('1', { tiempoPago: '30' });
};
const pagar = (agente, datos = {}, id = 1) =>
  agente.post(`/incapacidades/${id}/pago`).type('form').send({ valor: '1.250.000', fechaPago: '2026-11-20', origen: 'cobro', ...datos });

describe('HU-15 — registrar el pago (rutas)', () => {
  it('HU-15.CA1 — cobrada: la línea de tiempo termina en el formulario del pago', async () => {
    await cobrar();
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/cobro');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Esperando el pago');
    expect(res.text).toContain('action="/incapacidades/1/pago"');
    expect(res.text).toContain('name="origen" value="cobro"');
    expect(res.text).toContain('max="2026-11-21"');
    expect(res.text).toContain('min="2026-11-03"');
    expect(res.text).toContain('value="2026-11-21"'); // la fecha propone hoy
  });

  it('HU-15.CA1 — registra, redirige con la confirmación y muestra el pago en la línea de tiempo', async () => {
    await cobrar();
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await pagar(agente);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/incapacidades/1/cobro?pagado=1');
    expect(baseDeDatos.incapacidades[0].estado).toBe('pagada');

    const pagina = await agente.get(res.headers.location);
    expect(pagina.text).toContain('Pago registrado: $ 1.250.000 del viernes 20 de noviembre de 2026. La incapacidad quedó pagada.');
    expect(pagina.text).toContain('Pagada · <span class="cifra">$ 1.250.000</span>');
    expect(pagina.text).toContain('Registrar otro pago');
    expect(pagina.text).not.toContain('Esperando el pago');
  });

  it('HU-15.CA3 — con varios pagos muestra cada uno y el total', async () => {
    await cobrar();
    const agente = await agenteCon(request, app, 'auxiliar');
    await pagar(agente, { valor: '800.000', fechaPago: '2026-11-10' });
    await pagar(agente, { valor: '450.000,50', fechaPago: '2026-11-21' });
    const pagina = await agente.get('/incapacidades/1/cobro');
    expect(pagina.text).toContain('Otro pago · <span class="cifra">$ 450.000,5</span>');
    expect(pagina.text).toContain('Total pagado · <span class="cifra">$ 1.250.000,5</span>');
    expect(pagina.text).toContain('2 pagos');
  });

  it('HU-15.CA2 — el pago entra por una sola operación del Control: cobro.registrarPago', async () => {
    await cobrar();
    const espia = vi.spyOn(control, 'registrarPago');
    const agente = await agenteCon(request, app, 'auxiliar');
    await pagar(agente);
    expect(espia).toHaveBeenCalledWith('1', { valor: '1.250.000', fechaPago: '2026-11-20' }, expect.objectContaining({ id: 'id-auxiliar' }));
  });

  it('HU-15.CA2 — un origen desconocido vuelve al cobro (lista cerrada, sin redirecciones abiertas)', async () => {
    await cobrar();
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await pagar(agente, { origen: 'https://malicioso.test' });
    expect(res.headers.location).toBe('/incapacidades/1/cobro?pagado=1');
    const proto = await pagar(agente, { origen: '__proto__' });
    expect(proto.headers.location).toBe('/incapacidades/1/cobro?pagado=1');
    expect(Object.keys(ORIGENES_PAGO)).toContain('cobro');
  });

  it('HU-15 — datos no válidos: 400, conserva lo escrito, abre el formulario y no cambia el estado', async () => {
    await cobrar();
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await pagar(agente, { valor: 'mil', fechaPago: '2030-01-01' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('Escriba el valor en pesos');
    expect(res.text).toContain('La fecha del pago no puede ser posterior a hoy.');
    expect(res.text).toContain('value="mil"');
    expect(res.text).toContain('value="2030-01-01"');
    expect(baseDeDatos.incapacidades[0].estado).toBe('cobrada');
    expect(baseDeDatos.pagos).toHaveLength(0);
  });

  it('HU-15 — error en el segundo pago: el desplegable «Registrar otro pago» queda abierto', async () => {
    await cobrar();
    const agente = await agenteCon(request, app, 'auxiliar');
    await pagar(agente);
    const res = await pagar(agente, { valor: '' });
    expect(res.status).toBe(400);
    expect(res.text).toContain('<details class="otro-pago" open>');
  });

  it('HU-15 — lo escrito se escapa al volver a mostrarlo', async () => {
    await cobrar();
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await pagar(agente, { valor: '"><script>x</script>' });
    expect(res.status).toBe(400);
    expect(res.text).not.toContain('<script>x');
  });

  it('HU-15 — transcrita: 409 con el mensaje y sin formulario de pago', async () => {
    await control.registrarRadicacion('1', { radicado: 'R-1', evidencia: PDF }, USUARIOS.auxiliar);
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await pagar(agente);
    expect(res.status).toBe(409);
    expect(res.text).toContain('regístrela como cobrada antes del pago');
    expect(res.text).not.toContain('action="/incapacidades/1/pago"');
  });

  it('HU-15 — ?pagado=1 sobre una no pagada no muestra la confirmación', async () => {
    await cobrar();
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/cobro?pagado=1');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('Pago registrado');
  });

  it('no existe → 404', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await pagar(agente, {}, 99)).status).toBe(404);
  });

  it.each(['receptor', 'lider', 'contabilidad', 'cartera'])('DA-02 — %s no puede registrar un pago (403)', async (rol) => {
    await cobrar();
    const agente = await agenteCon(request, app, rol);
    expect((await pagar(agente)).status).toBe(403);
    expect(baseDeDatos.pagos).toHaveLength(0);
  });

  it('HU-01.CA3 — sin sesión, el POST se rechaza', async () => {
    const res = await request(app).post('/incapacidades/1/pago').type('form').send({ valor: '1000', fechaPago: '2026-11-20' });
    expect([302, 303, 401]).toContain(res.status);
    expect(baseDeDatos.pagos).toHaveLength(0);
  });
});

describe('HU-15 — un solo envío del formulario (DA-08)', () => {
  it('HU-15 — el formulario del pago se bloquea tras el primer envío (data-un-envio)', async () => {
    await cobrar();
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/cobro');
    expect(res.text).toMatch(/action="\/incapacidades\/1\/pago" novalidate data-un-envio>/);
    expect(res.text).toContain('data-enviando="Registrando…">Registrar el pago</button>');
  });
});
