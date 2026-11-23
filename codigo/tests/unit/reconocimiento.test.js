// HU-21 — reconocimiento económico (DS-09: calcularReconocimiento → guardarCalculo), con persistencia falsa.
// Decisiones: DA-09 (tramos e IBC ÷ 30), DA-10 (trámite de pensión desde el día 181) y DA-46.
import { beforeEach, describe, expect, it } from 'vitest';
import { calcularTramos, leerBusqueda, leerIbc } from '../../src/controllers/reconocimiento.controller.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { ErrorDeValidacion } from '../../src/controllers/error-de-validacion.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { formularioDeRegistro } from '../helpers/fabricas.js';
import { USUARIOS } from '../helpers/sesion-falsa.js';

let baseDeDatos;
let control;

const registrar = (dias) => control.registrarIncapacidad(formularioDeRegistro({ diasIncapacidad: String(dias) }), USUARIOS.receptor);

beforeEach(() => {
  baseDeDatos = crearBaseDeDatosFalsa();
  control = crearControlIncapacidades({ baseDeDatos, correo: crearCorreoFalso().correo });
});

describe('HU-21 — tramos del procedimiento (DA-09)', () => {
  // IBC de 3.000.000 → 100.000 por día (en centavos: 10.000.000).
  const IBC = 300_000_000;
  const pesos = (centavos) => centavos / 100;

  it('días 1 y 2: 100 % a cargo de la empresa', () => {
    expect(pesos(calcularTramos(2, IBC).valorEmpresa)).toBe(200_000);
    expect(calcularTramos(2, IBC).valorEPS).toBe(0);
  });

  it('un solo día: solo el primero, a cargo de la empresa', () => {
    const r = calcularTramos(1, IBC);
    expect([pesos(r.valorEmpresa), r.valorEPS]).toEqual([100_000, 0]);
  });

  it('días 3 a 90: 67 % a cargo de la EPS', () => {
    const r = calcularTramos(10, IBC); // 8 días × 67.000
    expect([pesos(r.valorEmpresa), pesos(r.valorEPS)]).toEqual([200_000, 536_000]);
  });

  it('días 91 a 180: 50 % a cargo de la EPS', () => {
    const r = calcularTramos(100, IBC); // 88 × 67.000 + 10 × 50.000
    expect(pesos(r.valorEPS)).toBe(88 * 67_000 + 10 * 50_000);
  });

  it('HU-21 — hasta 180 días no hay trámite de pensión; desde el 181, sí (DA-10)', () => {
    expect(calcularTramos(180, IBC).tramitePension).toBe(false);
    const r = calcularTramos(181, IBC);
    expect(r.tramitePension).toBe(true);
    expect(r.diasPension).toBe(1);
    expect(r.valorEPS).toBe(calcularTramos(180, IBC).valorEPS); // los días de pensión no se suman
  });

  it('redondea cada tramo al centavo y el detalle suma el total', () => {
    const r = calcularTramos(30, 100_000_001); // 1.000.000,01 no se divide exacto entre 30
    expect(r.tramos.every((t) => Number.isInteger(t.valor))).toBe(true);
    expect(r.tramos.filter((t) => t.aCargo === 'eps').reduce((a, t) => a + t.valor, 0)).toBe(r.valorEPS);
  });
});

describe('HU-21 — validar el IBC', () => {
  it.each([
    ['2.800.000', '2800000.00'],
    ['2800000', '2800000.00'],
    ['$ 1.250.000,50', '1250000.50'],
  ])('acepta «%s»', (texto, valor) => expect(leerIbc(texto).valor).toBe(valor));

  it.each(['', '   ', 'abc', '0', '-5', '1,2,3', undefined, 123])('rechaza %j', (texto) => expect(leerIbc(texto).error).toBeTruthy());

  it('acepta el tope y rechaza lo que lo supera (la EPS no desborda numeric(14,2))', () => {
    expect(leerIbc('10.000.000.000').valor).toBe('10000000000.00');
    expect(leerIbc('10.000.000.000,01').error).toMatch(/no puede superar/);
    expect(leerIbc('999999999999').error).toMatch(/no puede superar/);
    const EPS_MAXIMA = calcularTramos(180, 10_000_000_000 * 100).valorEPS / 100;
    expect(EPS_MAXIMA).toBeLessThan(999_999_999_999.99);
  });

  it('el mensaje de IBC vacío nombra el IBC, no el pago', () => {
    expect(leerIbc('').error).toBe('Escriba el IBC de la incapacidad.');
  });
});

describe('HU-21 — calcularReconocimiento guarda el resultado', () => {
  it('guarda el IBC, el valor de la empresa y el de la EPS y devuelve el resultado', async () => {
    await registrar(10);
    const r = await control.calcularReconocimiento('1', { ibc: '3.000.000' }, USUARIOS.auxiliar);
    expect(baseDeDatos.incapacidades[0]).toMatchObject({
      ibc: '3000000.00',
      valorEmpresa: '200000.00',
      valorEPS: '536000.00',
      tramitePension: false,
    });
    expect(r).toMatchObject({ idIncapacidad: 1, valorEmpresa: 20_000_000, valorEPS: 53_600_000, tramitePension: false });
  });

  it('DA-10 — con más de 180 días guarda el trámite de pensión', async () => {
    await registrar(200);
    await control.calcularReconocimiento('1', { ibc: '3000000' }, USUARIOS.auxiliar);
    expect(baseDeDatos.incapacidades[0].tramitePension).toBe(true);
  });

  it('calcular otra vez reemplaza el cálculo anterior', async () => {
    await registrar(10);
    await control.calcularReconocimiento('1', { ibc: '3000000' }, USUARIOS.auxiliar);
    await control.calcularReconocimiento('1', { ibc: '6000000' }, USUARIOS.auxiliar);
    expect(baseDeDatos.incapacidades[0]).toMatchObject({ ibc: '6000000.00', valorEmpresa: '400000.00' });
  });

  it('un IBC no válido no guarda nada y explica el campo', async () => {
    await registrar(10);
    const error = await control.calcularReconocimiento('1', { ibc: 'mucho' }, USUARIOS.auxiliar).catch((e) => e);
    expect(error).toBeInstanceOf(ErrorDeValidacion);
    expect(error.errores.ibc).toBeTruthy();
    expect(baseDeDatos.incapacidades[0].ibc).toBeUndefined();
  });

  it('una incapacidad que no existe devuelve null', async () => {
    expect(await control.calcularReconocimiento('99', { ibc: '1000' }, USUARIOS.auxiliar)).toBeNull();
    expect(await control.calcularReconocimiento('abc', { ibc: '1000' }, USUARIOS.auxiliar)).toBeNull();
    expect(await control.prepararReconocimiento('99')).toBeNull();
  });

  it('prepararReconocimiento muestra el cálculo guardado', async () => {
    await registrar(10);
    expect((await control.prepararReconocimiento('1')).resultado).toBeNull();
    await control.calcularReconocimiento('1', { ibc: '3000000' }, USUARIOS.auxiliar);
    expect((await control.prepararReconocimiento('1')).resultado).toMatchObject({ valorEmpresa: 20_000_000, valorEPS: 53_600_000 });
  });
});

describe('Auditoría T-21 a T-24 — el IBC y la pantalla del cálculo', () => {
  it.each([' ', '  ', '   '])('un campo con solo espacios duros %j pide el IBC', (texto) => {
    expect(leerIbc(texto).error).toBe('Escriba el IBC de la incapacidad.');
  });

  it('acepta el espacio duro y el estrecho que deja el formato de moneda', () => {
    expect(leerIbc('$ 2.800.000').valor).toBe('2800000.00');
    expect(leerIbc('$ 2.800.000,50').valor).toBe('2800000.50');
  });

  it.each(['abc', '0', '-5', '1,2,3', '9'.repeat(20)])('ningún error del IBC habla del pago de la entidad (%j)', (texto) => {
    const { error } = leerIbc(texto);
    expect(error).toMatch(/IBC/);
    expect(error).not.toMatch(/pagó|entidad|valor/);
  });

  it('muestra los totales guardados, no los recalculados con la fórmula vigente', async () => {
    await registrar(10);
    await control.calcularReconocimiento('1', { ibc: '3.000.000' }, USUARIOS.auxiliar);
    // Simula un cálculo guardado con una regla anterior.
    Object.assign(baseDeDatos.incapacidades[0], { valorEmpresa: '210000.00', valorEPS: '500000.00' });
    const { resultado } = await control.prepararReconocimiento('1');
    expect(resultado).toMatchObject({ valorEmpresa: 21_000_000, valorEPS: 50_000_000, desgloseCoincide: false, fechaCalculo: expect.any(String) });
    expect(resultado.tramos.map((t) => t.valor)).toEqual([20_000_000, 53_600_000, 0]); // solo el desglose
  });

  it('el trámite de pensión es el guardado', async () => {
    await registrar(200);
    await control.calcularReconocimiento('1', { ibc: '3000000' }, USUARIOS.auxiliar);
    baseDeDatos.incapacidades[0].tramitePension = false;
    expect((await control.prepararReconocimiento('1')).resultado.tramitePension).toBe(false);
  });

  it('si coincide no avisa', async () => {
    await registrar(10);
    await control.calcularReconocimiento('1', { ibc: '3.000.000' }, USUARIOS.auxiliar);
    expect((await control.prepararReconocimiento('1')).resultado.desgloseCoincide).toBe(true);
  });
});

describe('DA-53 — no se recalcula una incapacidad pagada', () => {
  it('se puede recalcular en cualquier otro estado', async () => {
    await registrar(10);
    for (const estado of [null, 'transcrita', 'cobrada', 'rechazada']) {
      baseDeDatos.incapacidades[0].estado = estado;
      expect(await control.calcularReconocimiento('1', { ibc: '3000000' }, USUARIOS.auxiliar)).toMatchObject({ idIncapacidad: 1 });
    }
  });

  it('pagada: 409 sin tocar lo guardado', async () => {
    await registrar(10);
    await control.calcularReconocimiento('1', { ibc: '3000000' }, USUARIOS.auxiliar);
    baseDeDatos.incapacidades[0].estado = 'pagada';
    const error = await control.calcularReconocimiento('1', { ibc: '6000000' }, USUARIOS.auxiliar).catch((e) => e);
    expect(error.errores.estado).toMatch(/pagada/);
    expect(baseDeDatos.incapacidades[0].ibc).toBe('3000000.00');
  });

  it('si se pagó entre la consulta y el cálculo, la base no lo guarda', async () => {
    await registrar(10);
    const obtener = baseDeDatos.obtenerDatosReconocimiento.bind(baseDeDatos);
    const carrera = crearControlIncapacidades({
      baseDeDatos: {
        ...baseDeDatos,
        async obtenerDatosReconocimiento(id) {
          const datos = await obtener(id);
          baseDeDatos.incapacidades[0].estado = 'pagada'; // otro usuario registra el pago justo ahora
          return datos;
        },
      },
      correo: crearCorreoFalso().correo,
    });
    const error = await carrera.calcularReconocimiento('1', { ibc: '3000000' }, USUARIOS.auxiliar).catch((e) => e);
    expect(error.errores.estado).toMatch(/pagada/);
    expect(baseDeDatos.incapacidades[0].ibc).toBeUndefined();
  });
});

describe('DA-50 y DA-51 — ARL, licencias, SMMLV y prórrogas', () => {
  const registrarComo = (tipo, entidad) =>
    control.registrarIncapacidad(formularioDeRegistro({ tipo, entidad: String(entidad), diasIncapacidad: '30' }), USUARIOS.receptor);

  it('enfermedad general con EPS: a cargo de la EPS y sin regla por validar', async () => {
    await registrarComo('enfermedad_general', 2);
    expect(await control.prepararReconocimiento('1')).toMatchObject({ aCargoDe: 'EPS', reglaPorValidar: false });
  });

  it('accidente laboral con ARL: a cargo de la ARL y con la regla por validar', async () => {
    await registrarComo('accidente_laboral', 1);
    expect(await control.prepararReconocimiento('1')).toMatchObject({ aCargoDe: 'ARL', reglaPorValidar: true });
  });

  it('una licencia aplica los mismos tramos con la regla por validar', async () => {
    await registrarComo('licencia_maternidad', 2);
    const r = await control.calcularReconocimiento('1', { ibc: '3.000.000' }, USUARIOS.auxiliar);
    expect(r).toMatchObject({ valorEmpresa: 20_000_000, valorEPS: calcularTramos(30, 300_000_000).valorEPS });
    expect((await control.prepararReconocimiento('1')).reglaPorValidar).toBe(true);
  });

  it('un IBC por debajo de 1 SMMLV se calcula igual y advierte', async () => {
    await registrar(10); // inicia en 2026
    await control.calcularReconocimiento('1', { ibc: '1.000.000' }, USUARIOS.auxiliar);
    expect(baseDeDatos.incapacidades[0].ibc).toBe('1000000.00');
    expect((await control.prepararReconocimiento('1')).advertenciaIbc).toMatchObject({ tipo: 'bajo', anio: 2026 });
  });

  it('sin cálculo no hay advertencia del IBC', async () => {
    await registrar(10);
    expect((await control.prepararReconocimiento('1')).advertenciaIbc).toBeNull();
  });
});

describe('Lista de reconocimiento — búsqueda por n.º o colaborador', () => {
  it.each([
    ['', null],
    ['   ', null],
    ['104', { texto: '104', id: 104 }],
    ['  Gómez  ', { texto: 'Gómez', nombre: 'Gómez' }],
    ['ana*', { texto: 'ana', nombre: 'ana' }],
    ['0', { texto: '0', id: 0 }],
    ['9'.repeat(30), { texto: '9'.repeat(30), id: 0 }],
  ])('leerBusqueda(%j)', (texto, esperado) => expect(leerBusqueda(texto)).toEqual(esperado));

  it('corta a 60 caracteres y no acepta otra cosa que texto', () => {
    expect(leerBusqueda('a'.repeat(100)).texto).toHaveLength(60);
    expect(leerBusqueda(['104'])).toBeNull();
  });

  it('busca por n.º exacto o por parte del nombre, sin distinguir mayúsculas', async () => {
    await control.registrarIncapacidad(formularioDeRegistro({ colaborador: 'Ana Restrepo', correoColaborador: 'ana@sigi.test' }), USUARIOS.receptor);
    await control.registrarIncapacidad(formularioDeRegistro({ colaborador: 'Luis Gil', correoColaborador: 'luis@sigi.test' }), USUARIOS.receptor);
    expect((await control.consultarReconocimientos('2')).filas.map((f) => f.idIncapacidad)).toEqual([2]);
    expect((await control.consultarReconocimientos('restre')).filas.map((f) => f.colaborador)).toEqual(['Ana Restrepo']);
    expect(await control.consultarReconocimientos('nadie')).toMatchObject({ total: 0, filas: [], busqueda: 'nadie' });
    expect(await control.consultarReconocimientos('0')).toMatchObject({ total: 0, filas: [] });
    expect((await control.consultarReconocimientos('')).filas).toHaveLength(2);
  });
});
