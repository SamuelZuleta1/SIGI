// T-31 — prueba integral: el recorrido completo de una incapacidad según AD-01, por HTTP y con los usuarios de
// demostración (DA-02), contra Supabase en la nube. Cada paso lo hace el actor de su diagrama de secuencia, con su
// propia sesión real (Supabase Auth): registro (receptor) → verificación con faltantes → radicación → rechazo →
// nueva radicación → cobrada → seguimiento con demora → requerimientos → traslado a Cartera → decisión (Cartera) →
// pago → pagos consignados (Contabilidad) → conciliación → archivo → entrega a Gestión Documental.
// Los correos se capturan con el transporte falso (no depende de Mailpit). Lo único que se toca directamente en la
// base es `fecha_cobrada`, para simular que pasó el tiempo prometido de pago (la demora no se puede esperar).
// Requisitos: proyecto vinculado, migraciones aplicadas, `npm run db:usuarios` y DEMO_PASSWORD en .env.
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { BUCKET_DOCUMENTOS, crearClienteServidor } from '../../src/config/supabase.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearBaseDeDatos } from '../../src/persistence/base-de-datos.js';
import { hoyEnColombia } from '../../src/servicios/dias-habiles.js';
import { crearServicioSesion } from '../../src/servicios/sesion.js';
import { DESTINATARIOS, crearCorreoFalso } from '../helpers/correo-falso.js';
import { PDF } from '../helpers/fabricas.js';

const servidor = crearClienteServidor();
const { correo, enviados } = crearCorreoFalso();
const app = crearApp({ sesion: crearServicioSesion(), control: crearControlIncapacidades({ baseDeDatos: crearBaseDeDatos(servidor), correo }) });

const marca = `Recorrido T-31 ${Date.now()}`;
const correoColaborador = `recorrido.${Date.now()}@t31.sigi.test`;
const hoy = hoyEnColombia();
const haceDias = (n) => {
  const fecha = new Date(`${hoy}T12:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() - n);
  return fecha.toISOString().slice(0, 10);
};

const agentes = {};
let entidad;
let id;
let idPago;
let idConciliacion;

const comprobar = ({ data, error }) => {
  if (error) throw error;
  return data;
};
const fila = async () => comprobar(await servidor.from('incapacidad').select('*').eq('id', id).single());
const correosA = (destino) => enviados.filter((m) => [m.to].flat().join(',').includes(destino)).length;

// Los pasos dependen del anterior: si uno falla, los siguientes se saltan en lugar de fallar con errores que despistan.
let roto = false;
beforeEach((contexto) => {
  if (roto) contexto.skip();
});
afterEach(({ task }) => {
  if (task.result?.state === 'fail') roto = true;
});

async function iniciarSesion(rol) {
  const agente = request.agent(app);
  const res = await agente.post('/iniciar-sesion').type('form').send({ correo: `${rol}1@sigi.test`, contrasena: process.env.DEMO_PASSWORD });
  if (res.status !== 302) throw new Error(`No entró ${rol}1@sigi.test: ejecute \`npm run db:usuarios\` y revise DEMO_PASSWORD`);
  return agente;
}

beforeAll(async () => {
  for (const rol of ['receptor', 'auxiliar', 'contabilidad', 'cartera']) agentes[rol] = await iniciarSesion(rol);
  entidad = comprobar(await servidor.from('entidad').select('id, nombre').eq('nombre', 'Nueva EPS').single());
});

afterAll(async () => {
  if (id) {
    // Las evidencias y los documentos quedan en el bucket: se borran antes de que la cascada borre sus rutas.
    const rutas = [
      ...comprobar(await servidor.from('documento').select('archivo').eq('incapacidad_id', id)).map((d) => d.archivo),
      ...comprobar(await servidor.from('radicacion').select('evidencia').eq('incapacidad_id', id)).map((r) => r.evidencia),
      ...comprobar(await servidor.from('seguimiento').select('evidencia').eq('incapacidad_id', id)).map((s) => s.evidencia),
    ].filter(Boolean);
    if (rutas.length) await servidor.storage.from(BUCKET_DOCUMENTOS).remove(rutas);
    await servidor.from('incapacidad').delete().eq('id', id); // en cascada: documentos, radicaciones, seguimientos, pagos…
  }
  await servidor.from('pago_consignado').delete().like('colaborador', `${marca}%`);
  if (idConciliacion) await servidor.from('conciliacion').delete().eq('id', idConciliacion);
  await servidor.from('colaborador').delete().eq('correo', correoColaborador);
});

describe('T-31 — recorrido completo de una incapacidad (AD-01)', () => {
  it('HU-03/HU-04 — el personal receptor registra la incapacidad y su soporte', async () => {
    const registro = await agentes.receptor.post('/incapacidades').type('form').send({
      colaborador: `${marca} Colaboradora`, correoColaborador, tipo: 'enfermedad_general', entidad: String(entidad.id),
      fechaInicio: haceDias(70), diasIncapacidad: '5', fechaRecepcion: haceDias(69),
    });
    expect(registro.status).toBe(303);
    id = Number(/registrada=(\d+)/.exec(registro.headers.location)?.[1]);
    expect(id).toBeGreaterThan(0);

    const documentos = await agentes.receptor.post(`/incapacidades/${id}/documentos`).attach('soporte_incapacidad', PDF, 'soporte.pdf');
    expect(documentos.status).toBe(303);
    // DA-02: el receptor no verifica.
    expect((await agentes.receptor.get(`/incapacidades/${id}/verificacion`)).status).toBe(403);
  });

  it('HU-06/HU-07 — el auxiliar ve que falta la epicrisis, avisa al colaborador, la recibe y confirma la verificación', async () => {
    const pagina = await agentes.auxiliar.get(`/incapacidades/${id}/verificacion`);
    expect(pagina.status).toBe(200);
    expect(pagina.text).toContain(`action="/incapacidades/${id}/faltantes"`);

    const antes = correosA(correoColaborador);
    expect((await agentes.auxiliar.post(`/incapacidades/${id}/faltantes`).type('form').send('faltantes=epicrisis')).status).toBe(303);
    expect(correosA(correoColaborador)).toBe(antes + 1);
    // Sin la epicrisis no se puede confirmar.
    expect((await agentes.auxiliar.post(`/incapacidades/${id}/verificacion`).type('form').send({})).status).toBe(409);

    expect((await agentes.auxiliar.post(`/incapacidades/${id}/documentos`).attach('epicrisis', PDF, 'epicrisis.pdf')).status).toBe(303);
    expect((await agentes.auxiliar.post(`/incapacidades/${id}/verificacion`).type('form').send({})).status).toBe(303);
    expect(await fila()).toMatchObject({ documentacion_completa: true, estado: null });
  });

  it('HU-10/HU-14 — radica, la entidad rechaza y se vuelve a radicar (rechazada → transcrita)', async () => {
    const radicar = (radicado) =>
      agentes.auxiliar.post(`/incapacidades/${id}/radicacion`).field('radicado', radicado).attach('evidencia', PDF, 'portal.pdf');
    expect((await radicar('NEPS-T31-1')).status).toBe(303);
    expect((await fila()).estado).toBe('transcrita');

    expect((await agentes.auxiliar.post(`/incapacidades/${id}/rechazo`).type('form').send({ causal: 'Soporte ilegible' })).status).toBe(303);
    expect(await fila()).toMatchObject({ estado: 'rechazada', causal_rechazo: 'Soporte ilegible' });

    expect((await radicar('NEPS-T31-2')).status).toBe(303);
    expect((await fila()).estado).toBe('transcrita');
    expect(comprobar(await servidor.from('radicacion').select('id').eq('incapacidad_id', id))).toHaveLength(2);
  });

  it('HU-13 — la entidad aprueba: queda cobrada con el tiempo prometido de pago', async () => {
    expect((await agentes.auxiliar.post(`/incapacidades/${id}/cobro`).type('form').send({ tiempoPago: '30' })).status).toBe(303);
    expect(await fila()).toMatchObject({ estado: 'cobrada', tiempo_pago: 30, fecha_cobrada: hoy });
    // Pasa el tiempo: la fecha prometida (cobrada + 30 días) ya venció hace 10 días.
    comprobar(await servidor.from('incapacidad').update({ fecha_cobrada: haceDias(40) }).eq('id', id));
  });

  it('HU-16/HU-17 — el seguimiento semanal la muestra con demora y avisa a la Coordinación', async () => {
    const lista = await agentes.auxiliar.get('/seguimiento');
    expect(lista.status).toBe(200);
    expect(lista.text).toContain(`${marca} Colaboradora`);

    const antes = correosA(DESTINATARIOS.coordinacion);
    const seguimiento = await agentes.auxiliar.post(`/incapacidades/${id}/seguimiento`).attach('evidencia', PDF, 'consulta.pdf');
    expect(seguimiento.status).toBe(303);
    expect(comprobar(await servidor.from('seguimiento').select('id').eq('incapacidad_id', id))).toHaveLength(1);
    expect(correosA(DESTINATARIOS.coordinacion)).toBe(antes + 1);
  });

  it('HU-18/HU-19 — dos requerimientos de cobro persuasivo y el traslado a Cartera y Jurídica', async () => {
    // Antes del traslado, Cartera no la ve (DA-45).
    expect((await agentes.cartera.get(`/incapacidades/${id}/decision`)).status).toBe(404);

    for (const n of [1, 2]) {
      const res = await agentes.auxiliar.post(`/incapacidades/${id}/requerimiento`).type('form').send({ fundamentos: `Requerimiento ${n}: pago vencido según el procedimiento.` });
      expect(res.status).toBe(303);
    }
    const antes = correosA(DESTINATARIOS.cartera);
    const traslado = await agentes.auxiliar.post(`/incapacidades/${id}/traslado`).type('form').send({ motivo: 'Sin pago tras dos requerimientos' });
    expect(traslado.status).toBe(303);
    expect((await fila()).motivo_traslado).toBe('Sin pago tras dos requerimientos');
    expect(correosA(DESTINATARIOS.cartera)).toBe(antes + 1);
  });

  it('HU-20 — Cartera y Jurídica decide recuperar el cobro', async () => {
    const lista = await agentes.cartera.get('/cartera');
    expect(lista.status).toBe(200);
    expect(lista.text).toContain(`${marca} Colaboradora`);
    expect((await agentes.cartera.post(`/incapacidades/${id}/decision`).type('form').send({ decision: 'recuperar' })).status).toBe(303);
    expect(await fila()).toMatchObject({ decision: 'recuperar', estado: 'cobrada' });
  });

  it('HU-15 — llega el pago tras el cobro jurídico: queda pagada', async () => {
    const pago = await agentes.auxiliar.post(`/incapacidades/${id}/pago`).type('form').send({ valor: '420.000', fechaPago: hoy, origen: 'cobro-juridico' });
    expect(pago.status).toBe(303);
    expect((await fila()).estado).toBe('pagada');
    idPago = comprobar(await servidor.from('pago').select('id').eq('incapacidad_id', id).single()).id;
  });

  it('HU-25 — Contabilidad y Tesorería registra el pago consignado por la entidad', async () => {
    const antes = correosA(DESTINATARIOS.auxiliar);
    const res = await agentes.contabilidad.post('/pagos-consignados').type('form').send({
      entidad: String(entidad.id), colaborador: [`${marca} Colaboradora`, ''], dias: ['5', ''], valor: ['420.000', ''],
    });
    expect(res.status).toBe(303);
    expect(correosA(DESTINATARIOS.auxiliar)).toBe(antes + 1);
  });

  it('HU-26 — el auxiliar concilia: el pago coincide con lo consignado', async () => {
    const antes = correosA(DESTINATARIOS.contabilidad);
    const res = await agentes.auxiliar.post('/conciliacion').type('form').send({ entidad: String(entidad.id), pagos: [String(idPago)] });
    expect(res.status).toBe(303);
    idConciliacion = Number(/\/conciliacion\/(\d+)/.exec(res.headers.location)?.[1]);
    const pago = comprobar(await servidor.from('pago').select('conciliado, conciliacion_id').eq('id', idPago).single());
    expect(pago).toEqual({ conciliado: true, conciliacion_id: idConciliacion });
    const consignado = comprobar(await servidor.from('pago_consignado').select('conciliacion_id').like('colaborador', `${marca}%`).single());
    expect(consignado.conciliacion_id).toBe(idConciliacion);
    expect(correosA(DESTINATARIOS.contabilidad)).toBe(antes + 1);
  });

  it('HU-29 — archiva: se elimina la epicrisis, se conserva el soporte y se avisa a Gestión Documental', async () => {
    const antes = correosA(DESTINATARIOS.gestionDocumental);
    expect((await agentes.auxiliar.post(`/incapacidades/${id}/archivo`).type('form').send({})).status).toBe(303);
    const tipos = comprobar(await servidor.from('documento').select('tipo').eq('incapacidad_id', id)).map((d) => d.tipo);
    expect(tipos).toEqual(['soporte_incapacidad']);
    expect((await fila()).fecha_archivo_preparado).not.toBeNull();
    expect(correosA(DESTINATARIOS.gestionDocumental)).toBe(antes + 1);
  });

  it('HU-30 — registra la entrega de los documentos físicos y el ciclo queda cerrado', async () => {
    const res = await agentes.auxiliar.post(`/incapacidades/${id}/archivo/envio`).type('form').send({ entregado: 'si' });
    expect(res.status).toBe(303);
    expect(await fila()).toMatchObject({ estado: 'pagada', enviada_a_gestion_documental: true });
    // Cerrado: ni otra entrega ni otro pago.
    expect((await agentes.auxiliar.post(`/incapacidades/${id}/archivo/envio`).type('form').send({ entregado: 'si' })).status).toBe(409);
    expect((await agentes.auxiliar.post(`/incapacidades/${id}/pago`).type('form').send({ valor: '1.000', fechaPago: hoy, origen: 'cobro' })).status).toBe(409);

    const estados = await agentes.auxiliar.get(`/estados?estado=pagada&colaborador=${encodeURIComponent(marca)}`);
    expect(estados.status).toBe(200);
    expect(estados.text).toContain('Enviada a Gestión Documental');
  });
});
