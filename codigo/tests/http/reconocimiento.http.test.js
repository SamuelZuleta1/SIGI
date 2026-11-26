// HU-21 — reconocimiento económico (DS-09), rutas con sesión y persistencia falsa (DA-02, DA-09, DA-10, DA-46).
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { formularioDeRegistro } from '../helpers/fabricas.js';
import { agenteCon, crearSesionFalsa, USUARIOS } from '../helpers/sesion-falsa.js';

let app;
let baseDeDatos;
let control;

const registrar = (dias) => control.registrarIncapacidad(formularioDeRegistro({ diasIncapacidad: String(dias) }), USUARIOS.receptor);
const calcular = (agente, ibc, id = 1) => agente.post(`/incapacidades/${id}/reconocimiento`).type('form').send({ ibc });

beforeEach(async () => {
  baseDeDatos = crearBaseDeDatosFalsa();
  control = crearControlIncapacidades({ baseDeDatos, correo: crearCorreoFalso().correo });
  app = crearApp({ sesion: crearSesionFalsa(), control });
  await registrar(10);
});

describe('HU-21 — reconocimiento económico (rutas)', () => {
  it('el auxiliar ve la lista con el menú «Reconocimiento»', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/reconocimiento');
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="/incapacidades/1/reconocimiento"');
    expect(res.text).toContain('Sin calcular');
    expect(res.text).toContain('href="/reconocimiento"');
  });

  it('la pantalla pide el IBC y no muestra resultado todavía', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/incapacidades/1/reconocimiento');
    expect(res.status).toBe(200);
    expect(res.text).toContain('name="ibc"');
    expect(res.text).not.toContain('A cargo de la empresa');
  });

  it('HU-21 — calcula, guarda y muestra los tramos y los totales', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await calcular(agente, '3.000.000');
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/incapacidades/1/reconocimiento?calculado=1');
    const pagina = await agente.get(res.headers.location);
    expect(pagina.text).toContain('Cálculo guardado.');
    expect(pagina.text).toContain('Días 1 y 2');
    expect(pagina.text).toContain('A cargo de la empresa');
    expect(pagina.text).toContain('$ 200.000');
    expect(pagina.text).toContain('$ 536.000');
    expect(pagina.text).not.toContain('Trámite de pensión');
    expect((await agente.get('/reconocimiento')).text).toContain('Calculado');
  });

  it('un enlace copiado con ?calculado=1 no muestra la confirmación si no hay cálculo', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.get('/incapacidades/1/reconocimiento?calculado=1')).text).not.toContain('Cálculo guardado.');
  });

  it('DA-10 — con más de 180 días avisa del trámite de pensión', async () => {
    await registrar(200);
    const agente = await agenteCon(request, app, 'auxiliar');
    await calcular(agente, '3000000', 2);
    const pagina = await agente.get('/incapacidades/2/reconocimiento?calculado=1');
    expect(pagina.text).toContain('Trámite de pensión');
    expect(pagina.text).toContain('20 días desde el día 181');
    expect((await agente.get('/reconocimiento')).text).toContain('Trámite de pensión');
  });

  it('un IBC no válido: 400 con el error junto al campo y lo escrito conservado', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await calcular(agente, 'mucho');
    expect(res.status).toBe(400);
    expect(res.text).toContain('Escriba el IBC en pesos');
    expect(res.text).toContain('value="mucho"');
    expect(baseDeDatos.incapacidades[0].ibc).toBeUndefined();
  });

  it('un IBC por encima del tope: 400 con el mensaje en el campo, sin error 500', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await calcular(agente, '900.000.000.000');
    expect(res.status).toBe(400);
    expect(res.text).toContain('El IBC no puede superar');
    expect(baseDeDatos.incapacidades[0].ibc).toBeUndefined();
  });

  it('el IBC escapa HTML', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await calcular(agente, '"><script>x</script>');
    expect(res.text).not.toContain('<script>x');
  });

  it('una incapacidad que no existe: 404', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.get('/incapacidades/99/reconocimiento')).status).toBe(404);
    expect((await calcular(agente, '1000', 99)).status).toBe(404);
  });

  it.each(['receptor', 'lider', 'contabilidad', 'cartera'])('DA-02 — el rol %s no calcula: 403', async (rol) => {
    const agente = await agenteCon(request, app, rol);
    expect((await agente.get('/reconocimiento')).status).toBe(403);
    expect((await agente.get('/incapacidades/1/reconocimiento')).status).toBe(403);
    expect((await calcular(agente, '3000000')).status).toBe(403);
    expect(baseDeDatos.incapacidades[0].ibc).toBeUndefined();
  });

  it('sin sesión: GET redirige al inicio de sesión y POST responde 401', async () => {
    expect((await request(app).get('/reconocimiento')).status).toBe(302);
    expect((await request(app).post('/incapacidades/1/reconocimiento').type('form').send({ ibc: '1' })).status).toBe(401);
  });
});

describe('Auditoría T-21 a T-24 — la pantalla muestra lo guardado', () => {
  it('si la regla cambió desde el cálculo, muestra los totales guardados y avisa', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    await calcular(agente, '3.000.000');
    Object.assign(baseDeDatos.incapacidades[0], { valorEmpresa: '210000.00' });
    const pagina = await agente.get('/incapacidades/1/reconocimiento');
    expect(pagina.text).toContain('$ 210.000');
    expect(pagina.text).toContain('no coincide');
    expect(pagina.text).toMatch(/calculado el \d{1,2} \w+ \d{4}/);
  });

  it('un IBC con solo un espacio duro: 400 que pide el IBC', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await calcular(agente, ' ');
    expect(res.status).toBe(400);
    expect(res.text).toContain('Escriba el IBC de la incapacidad.');
  });
});

describe('DA-53 — incapacidad pagada (rutas)', () => {
  it('no ofrece el formulario, muestra lo guardado y el POST responde 409', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    await calcular(agente, '3.000.000');
    baseDeDatos.incapacidades[0].estado = 'pagada';
    const pagina = await agente.get('/incapacidades/1/reconocimiento');
    expect(pagina.text).toContain('Pagada: este es el cálculo guardado y ya no se puede cambiar.');
    expect(pagina.text).not.toContain('name="ibc"');
    expect(pagina.text).toContain('$ 200.000');
    const res = await calcular(agente, '6.000.000');
    expect(res.status).toBe(409);
    expect(res.text).toContain('su reconocimiento ya no se calcula ni se cambia');
  });
});

describe('DA-50 y DA-51 — advertencias junto a su dato (rutas)', () => {
  it('ARL: la tabla dice «A cargo de la ARL» y explica la regla de origen laboral', async () => {
    await control.registrarIncapacidad(formularioDeRegistro({ tipo: 'accidente_laboral', entidad: '1', diasIncapacidad: '30' }), USUARIOS.receptor);
    const agente = await agenteCon(request, app, 'auxiliar');
    await calcular(agente, '3.000.000', 2);
    const pagina = await agente.get('/incapacidades/2/reconocimiento');
    expect(pagina.text).toContain('A cargo de la ARL');
    expect(pagina.text).not.toContain('A cargo de la EPS');
    expect(pagina.text).not.toContain('Regla por validar');
    expect(pagina.text).toContain('Día 1 (día del evento)');
    expect(pagina.text).toContain('desde el día siguiente la ARL paga el 100 %');
  });

  it('enfermedad general sin prórroga: sin nota de regla ni de prórroga', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    await calcular(agente, '3.000.000');
    const pagina = await agente.get('/incapacidades/1/reconocimiento');
    expect(pagina.text).not.toContain('Origen laboral');
    expect(pagina.text).not.toContain('Prórroga de la');
  });

  it.each([
    ['1.000.000', 'IBC por debajo de 1 SMMLV de 2026 ($ 1.750.905)'],
    ['50.000.000', 'IBC por encima de 25 SMMLV de 2026 ($ 43.772.625, tope de cotización)'],
  ])('IBC %s: se guarda y advierte bajo el campo', async (ibc, aviso) => {
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await calcular(agente, ibc)).status).toBe(303);
    const pagina = await agente.get('/incapacidades/1/reconocimiento');
    expect(pagina.text).toContain(aviso);
    expect(pagina.text).toContain('aria-describedby="ayuda-ibc advertencia-ibc"');
  });

  it('un IBC dentro del rango no advierte', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    await calcular(agente, '3.000.000');
    expect((await agente.get('/incapacidades/1/reconocimiento')).text).not.toContain('SMMLV');
  });
});

describe('Lista de reconocimiento — búsqueda (rutas)', () => {
  it('el formulario GET filtra, cuenta las que coinciden y ofrece quitar la búsqueda', async () => {
    await control.registrarIncapacidad(formularioDeRegistro({ colaborador: 'Luis Gil', correoColaborador: 'luis@sigi.test' }), USUARIOS.receptor);
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/reconocimiento?q=gil');
    expect(res.status).toBe(200);
    expect(res.text).toContain('name="q"');
    expect(res.text).toContain('value="gil"');
    expect(res.text).toContain('que coincide con «gil»');
    expect(res.text).toContain('href="/incapacidades/2/reconocimiento"');
    expect(res.text).not.toContain('href="/incapacidades/1/reconocimiento"');
    expect(res.text).toContain('href="/reconocimiento">Quitar');
  });

  it('sin coincidencias explica qué revisar; la búsqueda escapa HTML', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await agente.get('/reconocimiento?q=%3Cscript%3Ex');
    expect(res.text).toContain('Ninguna incapacidad coincide con «&lt;script&gt;x»');
    expect(res.text).not.toContain('<script>x');
  });

  it('sin tildes: «gil» y «GÍL» encuentran a «Luis Gil»', async () => {
    await control.registrarIncapacidad(formularioDeRegistro({ colaborador: 'Luis Gil', correoColaborador: 'luis@sigi.test' }), USUARIOS.receptor);
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.get('/reconocimiento?q=G%C3%8DL')).text).toContain('href="/incapacidades/2/reconocimiento"');
  });

  it('?q repetido toma el primero', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.get('/reconocimiento?q=1&q=2')).text).toContain('href="/incapacidades/1/reconocimiento"');
  });
});

describe('Reconocimiento — calcular en la propia fila de la lista', () => {
  const json = (agente, ibc, id = 1) =>
    agente.post(`/incapacidades/${id}/reconocimiento`).set('Accept', 'application/json').type('form').send({ ibc });

  it('la lista trae el IBC de cada fila: un formulario por incapacidad sin pagar, y los valores sin calcular en «—»', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const { text } = await agente.get('/reconocimiento');
    expect(text).toContain('<form class="ibc-fila" method="post" action="/incapacidades/1/reconocimiento"');
    expect(text).toContain('data-calculo-en-fila');
    expect(text).toContain('aria-label="IBC de la incapacidad 1 (pesos)"');
    expect(text).toContain('>Calcular</button>');
    expect(text).toMatch(/data-ver-tramos[^>]*>Ver tramos/);
    expect(text).toMatch(/href="\/incapacidades\/1\/reconocimiento" hidden/); // sin cálculo no hay tramos que ver
  });

  it('con Accept: JSON devuelve los valores de la fila y el detalle por tramos, y guarda el cálculo', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await json(agente, '3.000.000');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ idIncapacidad: 1, ibc: '3.000.000', empresa: '$ 200.000', entidad: '$ 536.000', tramitePension: false, advertencia: null });
    expect(res.body.detalle).toContain('A cargo de la empresa');
    expect(res.body.detalle).toContain('aria-labelledby="titulo-resultado-1"');
    expect(baseDeDatos.incapacidades[0].ibc).toBe('3000000.00');
    // Y la lista ya lo muestra calculado, con el IBC escrito y «Recalcular».
    const lista = (await agente.get('/reconocimiento')).text;
    expect(lista).toContain('value="3.000.000"');
    expect(lista).toContain('>Recalcular</button>');
    expect(lista).toContain('Calculado');
    expect(lista).not.toMatch(/href="\/incapacidades\/1\/reconocimiento" hidden/);
  });

  it('avisa si el IBC está fuera de lo habitual, pero calcula igual (DA-50)', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await json(agente, '500.000');
    expect(res.status).toBe(200);
    expect(res.body.advertencia).toMatch(/^IBC por debajo de 1 SMMLV de 2026/);
  });

  it.each([['', 400], ['abc', 400], ['-5', 400]])('IBC «%s» no válido: 400 con el mensaje en JSON y sin guardar', async (ibc, estado) => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await json(agente, ibc);
    expect(res.status).toBe(estado);
    expect(res.body.errores.ibc).toBeTruthy();
    expect(baseDeDatos.incapacidades[0].ibc).toBeUndefined();
  });

  it('una incapacidad pagada no se calcula (DA-53): 409 en JSON, y su fila no ofrece el formulario', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    await json(agente, '3.000.000');
    baseDeDatos.incapacidades[0].estado = 'pagada';
    const res = await json(agente, '4.000.000');
    expect(res.status).toBe(409);
    expect(res.body.errores.estado).toBeTruthy();
    expect(baseDeDatos.incapacidades[0].ibc).toBe('3000000.00');
    const lista = (await agente.get('/reconocimiento')).text;
    expect(lista).not.toContain('class="ibc-fila"');
    expect(lista).toContain('<span class="chip pagada">Pagada</span>');
  });

  it('incapacidad inexistente: 404 en JSON', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await json(agente, '3.000.000', 99);
    expect(res.status).toBe(404);
    expect(res.body.errores.estado).toBe('No hay una incapacidad con ese número.');
  });

  it('sin Accept: JSON sigue siendo el POST de siempre (303 a la pantalla de cálculo)', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    const res = await calcular(agente, '3.000.000');
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/incapacidades/1/reconocimiento?calculado=1');
  });

  it('GET …/detalle da el detalle por tramos de lo calculado (HTML sin la página), y 404 sin cálculo o sin incapacidad', async () => {
    const agente = await agenteCon(request, app, 'auxiliar');
    expect((await agente.get('/incapacidades/1/reconocimiento/detalle')).status).toBe(404);
    await calcular(agente, '3.000.000');
    const res = await agente.get('/incapacidades/1/reconocimiento/detalle');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toContain('A cargo de la empresa');
    expect(res.text).not.toContain('<html');
    expect((await agente.get('/incapacidades/99/reconocimiento/detalle')).status).toBe(404);
  });

  it.each(['receptor', 'lider', 'contabilidad', 'cartera'])('DA-02 — %s no calcula ni ve el detalle (403)', async (rol) => {
    const agente = await agenteCon(request, app, rol);
    expect((await json(agente, '3.000.000')).status).toBe(403);
    expect((await agente.get('/incapacidades/1/reconocimiento/detalle')).status).toBe(403);
    expect(baseDeDatos.incapacidades[0].ibc).toBeUndefined();
  });
});
