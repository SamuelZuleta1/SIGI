// HU-29 — archivar una incapacidad pagada (DS-13), rutas con sesión y persistencia falsa (DA-02, DA-11, DA-12, DA-59).
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { crearApp } from '../../src/app.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { PDF, pagoRegistrado } from '../helpers/fabricas.js';
import { agenteCon, crearSesionFalsa } from '../helpers/sesion-falsa.js';

let app;
let baseDeDatos;
let enviados;
let correo;

async function pagada({ colaborador = 'Ana María Gómez', conciliado = true, epicrisis = false } = {}) {
  const idPago = await pagoRegistrado(baseDeDatos, { colaborador, valor: '420000.00' });
  const pago = baseDeDatos.pagos.find((p) => p.idPago === idPago);
  if (conciliado) Object.assign(pago, { conciliado: true, conciliacionId: 1 });
  if (epicrisis) await baseDeDatos.guardarDocumentos(pago.idIncapacidad, [{ tipo: 'epicrisis', contenido: PDF, tipoMime: 'application/pdf' }], 'id-auxiliar');
  return pago.idIncapacidad;
}
const archivar = (agente, id) => agente.post(`/incapacidades/${id}/archivo`).type('form').send({});
const registrarEnvio = (agente, id, datos = { entregado: 'si' }) => agente.post(`/incapacidades/${id}/archivo/envio`).type('form').send(datos);

beforeEach(() => {
  baseDeDatos = crearBaseDeDatosFalsa();
  ({ correo, enviados } = crearCorreoFalso());
  const control = crearControlIncapacidades({ baseDeDatos, correo });
  app = crearApp({ sesion: crearSesionFalsa(), control });
});

describe('HU-29.CA1 — lista de pagadas (GET /archivo)', () => {
  it('el auxiliar ve el menú «Archivo» y las pagadas por archivar', async () => {
    const lista = await pagada({ colaborador: 'Ana Gómez' });
    await pagada({ colaborador: 'Luis Pérez', conciliado: false });
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/archivo');
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="/archivo"');
    expect(res.text).toContain(`href="/incapacidades/${lista}/archivo"`);
    expect(res.text).toContain('Ana Gómez');
    expect(res.text).not.toContain('Luis Pérez');
    expect(res.text).toMatch(/Pago sin conciliar<span class="n"><span class="oculto">: <\/span>1/);
    expect((await agente.get('/archivo?ver=sin_conciliar')).text).toContain('Luis Pérez');
  });

  it('solo el auxiliar consulta y archiva (DA-02)', async () => {
    const id = await pagada();
    for (const rol of ['receptor', 'lider', 'contabilidad', 'cartera']) {
      const agente = await agenteCon(request, app, rol);
      expect((await agente.get('/archivo')).status).toBe(403);
      expect((await agente.get(`/incapacidades/${id}/archivo`)).status).toBe(403);
      expect((await archivar(agente, id)).status).toBe(403);
      expect((await agente.get('/')).text).not.toContain('href="/archivo"');
    }
    expect(enviados).toHaveLength(0);
  });

  it('una incapacidad que no existe o no está pagada: 404', async () => {
    await pagada();
    baseDeDatos.incapacidades[0].estado = 'cobrada';
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.get('/incapacidades/1/archivo')).status).toBe(404);
    expect((await agente.get('/incapacidades/99/archivo')).status).toBe(404);
    expect((await archivar(agente, 99)).status).toBe(404);
  });
});

describe('HU-29.CA2 — archivar (POST /incapacidades/:id/archivo)', () => {
  it('advierte antes de archivar y, al archivar, confirma que el archivo está preparado', async () => {
    const id = await pagada({ epicrisis: true });
    const agente = await agenteCon(request, app, 'auxiliar');
    const antes = await agente.get(`/incapacidades/${id}/archivo`);
    expect(antes.text).toContain('Se eliminará la epicrisis de SIGI');
    expect(antes.text).toContain(`action="/incapacidades/${id}/archivo"`);

    const res = await archivar(agente, id);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`/incapacidades/${id}/archivo?preparado=1`);
    const despues = await agente.get(res.headers.location);
    expect(despues.text).toContain('Archivo preparado: se eliminó la epicrisis (si la tenía) y se envió el correo a Gestión Documental');
    expect(despues.text).not.toContain(`action="/incapacidades/${id}/archivo"`);
    expect(baseDeDatos.documentos).toHaveLength(0);
    expect(enviados).toHaveLength(1);
  });

  it('la confirmación no aparece por la URL si no quedó preparado', async () => {
    const id = await pagada();
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.get(`/incapacidades/${id}/archivo?preparado=1`)).text).not.toContain('Archivo preparado:');
  });

  it('archivar otra vez: 409 sin otro correo', async () => {
    const id = await pagada();
    const agente = await agenteCon(request, app, 'auxiliar');
    await archivar(agente, id);
    const res = await archivar(agente, id);
    expect(res.status).toBe(409);
    expect(res.text).toContain('ya está preparado');
    expect(enviados).toHaveLength(1);
  });

  it('si el correo falla: 502, no queda preparado y se puede reintentar', async () => {
    const id = await pagada();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(correo, 'enviarParaArchivo').mockRejectedValueOnce(new Error('SMTP caído'));
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await archivar(agente, id);
    expect(res.status).toBe(502);
    expect(res.text).toContain('No se pudo enviar el correo a Gestión Documental');
    expect(res.text).toContain(`action="/incapacidades/${id}/archivo"`);
    expect((await archivar(agente, id)).status).toBe(303);
  });

  it('si no se puede eliminar la epicrisis: 502 con su propio mensaje y sin correo; si tampoco se quita la marca: 500', async () => {
    const id = await pagada({ epicrisis: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    baseDeDatos.eliminarEpicrisis = async () => {
      throw new Error('Storage caído');
    };
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await archivar(agente, id);
    expect(res.status).toBe(502);
    expect(res.text).toContain('No se pudo eliminar la epicrisis: el archivo no quedó preparado');
    expect(enviados).toHaveLength(0);
    baseDeDatos.deshacerArchivoPreparado = async () => {
      throw new Error('BD caída');
    };
    const sinDeshacer = await archivar(agente, id);
    expect(sinDeshacer.status).toBe(500);
    expect(sinDeshacer.text).toContain('No se pudo eliminar la epicrisis y no se pudo quitar la marca');
  });

  it('si el correo falla y no se puede quitar la marca: 500 que lo dice', async () => {
    const id = await pagada();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(correo, 'enviarParaArchivo').mockRejectedValueOnce(new Error('SMTP caído'));
    baseDeDatos.deshacerArchivoPreparado = async () => {
      throw new Error('BD caída');
    };
    const res = await archivar(await agenteCon(request, app, 'auxiliar'), id);
    expect(res.status).toBe(500);
    expect(res.text).toContain('no se pudo quitar la marca de archivo preparado');
  });
});

describe('HU-29.CA3 — pago no identificado', () => {
  it('la pantalla advierte y no ofrece archivar; si se intenta: 409 con la advertencia y sin correo', async () => {
    const id = await pagada({ conciliado: false, epicrisis: true });
    const agente = await agenteCon(request, app, 'auxiliar');
    const pagina = await agente.get(`/incapacidades/${id}/archivo`);
    expect(pagina.text).toContain('El pago no está identificado y conciliado');
    expect(pagina.text).not.toContain(`action="/incapacidades/${id}/archivo"`);

    const res = await archivar(agente, id);
    expect(res.status).toBe(409);
    expect(res.text).toContain('aún no está identificado y conciliado: no se puede archivar');
    expect(enviados).toHaveLength(0);
    expect(baseDeDatos.documentos).toHaveLength(1);
  });
});

describe('HU-30.CA1 — registrar el envío (POST /incapacidades/:id/archivo/envio)', () => {
  it('con el archivo preparado ofrece el paso final; al registrarlo confirma el fin del ciclo y pasa a «Enviadas»', async () => {
    const id = await pagada({ colaborador: 'Ana Gómez' });
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.get(`/incapacidades/${id}/archivo`)).text).not.toContain('/archivo/envio');
    await archivar(agente, id);
    const antes = await agente.get(`/incapacidades/${id}/archivo`);
    expect(antes.text).toContain('Entregar los documentos físicos');
    expect(antes.text).toContain(`action="/incapacidades/${id}/archivo/envio"`);

    const res = await registrarEnvio(agente, id);
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`/incapacidades/${id}/archivo?enviada=1`);
    const despues = await agente.get(res.headers.location);
    expect(despues.text).toContain(`Envío registrado: la incapacidad n.º ${id} quedó enviada a Gestión Documental. Fin del ciclo.`);
    expect(despues.text).toContain('Enviada a Gestión Documental');
    expect(despues.text).toContain('auxiliar@sigi.test');
    expect(despues.text).not.toContain('/archivo/envio');
    expect(enviados).toHaveLength(1);

    expect((await agente.get('/archivo?ver=preparado')).text).not.toContain('Ana Gómez');
    const enviadas = await agente.get('/archivo?ver=enviada');
    expect(enviadas.text).toContain('Ana Gómez');
    expect(enviadas.text).toMatch(/Enviadas<span class="n"><span class="oculto">: <\/span>1/);
    expect(enviadas.text).not.toContain('Se muestran las');

    // Consultar estados (HU-11) también muestra el fin del ciclo; el estado sigue en «Pagada».
    const estados = await agente.get('/estados?estado=pagada');
    expect(estados.text).toContain('Enviada a Gestión Documental');
  });

  it('sin la casilla: 400 con el error junto a ella y nada registrado', async () => {
    const id = await pagada();
    const agente = await agenteCon(request, app, 'auxiliar');
    await archivar(agente, id);
    const res = await registrarEnvio(agente, id, {});
    expect(res.status).toBe(400);
    expect(res.text).toContain('id="error-entregado"');
    expect(res.text).toContain('aria-invalid="true"');
    expect(res.text).toContain('href="/archivo" aria-current="page"'); // el menú sigue en «Archivo»
    expect(baseDeDatos.incapacidades[0].enviadaAGestionDocumental).toBeFalsy();
    expect((await agente.get('/estados?estado=pagada')).text).not.toContain('Enviada a Gestión Documental');
  });

  it('sin archivo preparado o ya enviada: 409; la confirmación no aparece por la URL', async () => {
    const id = await pagada();
    const agente = await agenteCon(request, app, 'auxiliar');
    const sinPreparar = await registrarEnvio(agente, id);
    expect(sinPreparar.status).toBe(409);
    expect(sinPreparar.text).toContain('Primero archive la incapacidad');
    expect((await agente.get(`/incapacidades/${id}/archivo?enviada=1`)).text).not.toContain('Envío registrado:');

    await archivar(agente, id);
    await registrarEnvio(agente, id);
    const otraVez = await registrarEnvio(agente, id);
    expect(otraVez.status).toBe(409);
    expect(otraVez.text).toContain('ya está registrado');
  });

  it('solo el auxiliar registra el envío (DA-02); una que no existe: 404', async () => {
    const id = await pagada();
    await archivar(await agenteCon(request, app, 'auxiliar'), id);
    for (const rol of ['receptor', 'lider', 'contabilidad', 'cartera']) {
      expect((await registrarEnvio(await agenteCon(request, app, rol), id)).status).toBe(403);
    }
    expect(baseDeDatos.incapacidades[0].enviadaAGestionDocumental).toBeFalsy();
    expect((await registrarEnvio(await agenteCon(request, app, 'auxiliar'), 99)).status).toBe(404);
  });
});
