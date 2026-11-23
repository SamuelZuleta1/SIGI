// HU-27 — generar el reporte de ausentismo (DS-12; DA-21, DA-57), con persistencia y correo falsos.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { ErrorDeAviso } from '../../src/controllers/error-de-aviso.js';
import { ErrorDeValidacion } from '../../src/controllers/error-de-validacion.js';
import {
  DOBLE_ENVIO_MS,
  GRUPOS_HITO,
  clasificarPorHito,
  consolidarDatos,
  corteDelPeriodo,
  corteDelReporte,
  hitoAlCorte,
  porHito,
  totalesProlongadas,
  diasPorTipo,
  leerPeriodo,
  limitesDelPeriodo,
  periodoAnterior,
  totalesDelReporte,
} from '../../src/controllers/reportes.controller.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso, DESTINATARIOS } from '../helpers/correo-falso.js';

const HOY = '2026-11-02';
const auxiliar = { id: 'id-auxiliar' };

const incapacidad = (cambios = {}) => ({
  idIncapacidad: 1,
  colaborador: 'Ana Gómez',
  tipo: 'enfermedad_general',
  entidad: 'Nueva EPS',
  fechaInicio: '2026-10-05',
  diasIncapacidad: 3,
  estado: null,
  ...cambios,
});

let baseDeDatos;
let correo;
let enviados;
let control;

async function registrar(nombre, { fechaInicio, diasIncapacidad, tipo = 'enfermedad_general', entidad = 2, estado = null }) {
  const correoColaborador = `${nombre.replace(/\s+/g, '.').toLowerCase()}@sigi.test`;
  const id = await baseDeDatos.guardarIncapacidad(
    { colaborador: { nombre, correo: correoColaborador }, entidad, tipo, fechaInicio, diasIncapacidad, fechaRecepcion: fechaInicio },
    'id-receptor',
  );
  baseDeDatos.incapacidades.find((i) => i.idIncapacidad === id).estado = estado;
  return id;
}

beforeEach(() => {
  baseDeDatos = crearBaseDeDatosFalsa();
  ({ correo, enviados } = crearCorreoFalso());
  control = crearControlIncapacidades({ baseDeDatos, correo });
});

describe('HU-27 — periodo del reporte (DA-57)', () => {
  it('sugiere el mes anterior, también en enero', () => {
    expect(periodoAnterior('2026-11-02')).toBe('2026-10');
    expect(periodoAnterior('2027-01-31')).toBe('2026-12');
  });

  it('calcula el primer y el último día del mes, con febrero bisiesto', () => {
    expect(limitesDelPeriodo('2026-10')).toEqual({ desde: '2026-10-01', hasta: '2026-10-31' });
    expect(limitesDelPeriodo('2028-02')).toEqual({ desde: '2028-02-01', hasta: '2028-02-29' });
  });

  it.each([
    ['', 'Elija el mes del reporte.'],
    ['2026-13', 'Escriba el mes como AAAA-MM, por ejemplo 2026-10.'],
    ['oct 2026', 'Escriba el mes como AAAA-MM, por ejemplo 2026-10.'],
    ['2019-12', 'Elija un mes desde 2020-01.'],
    ['2026-12', 'El mes del reporte no puede ser futuro.'],
  ])('rechaza «%s»', (texto, error) => {
    expect(leerPeriodo(texto, HOY)).toEqual({ error });
  });

  it('acepta el mes en curso y uno pasado', () => {
    expect(leerPeriodo('2026-11', HOY)).toEqual({ valor: '2026-11' });
    expect(leerPeriodo(' 2026-10 ', HOY)).toEqual({ valor: '2026-10' });
  });
});

describe('HU-27 — consolidarDatos (DA-21, DA-57)', () => {
  it('incluye las que tienen algún día en el mes y cuenta solo esos días', () => {
    const filas = consolidarDatos(
      [
        incapacidad({ idIncapacidad: 1, fechaInicio: '2026-10-05', diasIncapacidad: 3 }), // dentro: 3
        incapacidad({ idIncapacidad: 2, fechaInicio: '2026-09-25', diasIncapacidad: 10 }), // empieza antes: 1–4 oct
        incapacidad({ idIncapacidad: 3, fechaInicio: '2026-10-29', diasIncapacidad: 10 }), // sigue después: 29–31
        incapacidad({ idIncapacidad: 4, fechaInicio: '2026-09-01', diasIncapacidad: 90 }), // cubre todo el mes
        incapacidad({ idIncapacidad: 5, fechaInicio: '2026-09-21', diasIncapacidad: 10 }), // termina el 30 sep
        incapacidad({ idIncapacidad: 6, fechaInicio: '2026-11-01', diasIncapacidad: 2 }), // empieza después
      ],
      '2026-10',
    );
    expect(filas.map((f) => [f.idIncapacidad, f.diasEnPeriodo])).toEqual([[4, 31], [2, 4], [1, 3], [3, 3]]);
  });

  it('guarda las columnas de DA-21 y el estado «registrada» cuando no tiene', () => {
    const [fila] = consolidarDatos([incapacidad({ estado: null })], '2026-10');
    expect(fila).toEqual({
      idIncapacidad: 1,
      colaborador: 'Ana Gómez',
      tipo: 'enfermedad_general',
      entidad: 'Nueva EPS',
      fechaInicio: '2026-10-05',
      fechaFin: '2026-10-07',
      diasIncapacidad: 3,
      diasEnPeriodo: 3,
      estado: 'registrada',
    });
  });

  it('una incapacidad de un día el último día del mes cuenta 1', () => {
    expect(consolidarDatos([incapacidad({ fechaInicio: '2026-10-31', diasIncapacidad: 1 })], '2026-10')[0].diasEnPeriodo).toBe(1);
  });

  it('totales y días por tipo', () => {
    const filas = consolidarDatos(
      [
        incapacidad({ idIncapacidad: 1, colaborador: 'Ana Gómez', fechaInicio: '2026-10-05', diasIncapacidad: 3 }),
        incapacidad({ idIncapacidad: 2, colaborador: 'Ana Gómez', fechaInicio: '2026-10-20', diasIncapacidad: 2 }),
        incapacidad({ idIncapacidad: 3, colaborador: 'Luis Pérez', tipo: 'licencia_paternidad', fechaInicio: '2026-10-01', diasIncapacidad: 14 }),
      ],
      '2026-10',
    );
    expect(totalesDelReporte(filas)).toEqual({ incapacidades: 3, colaboradores: 2, diasEnPeriodo: 19 });
    expect(diasPorTipo(filas)).toEqual([
      { tipo: 'licencia_paternidad', incapacidades: 1, dias: 14 },
      { tipo: 'enfermedad_general', incapacidades: 2, dias: 5 },
    ]);
  });
});

describe('HU-27 — generarReporte (DS-12)', () => {
  it('HU-27.CA1 — consolida el periodo, guarda el reporte con su contenido y lo envía al SG-SST', async () => {
    await registrar('Ana Gómez', { fechaInicio: '2026-10-05', diasIncapacidad: 3, estado: 'transcrita' });
    await registrar('Luis Pérez', { fechaInicio: '2026-09-28', diasIncapacidad: 7 });
    await registrar('Marta Ruiz', { fechaInicio: '2026-11-01', diasIncapacidad: 2 });

    const resultado = await control.generarReporte('ausentismo', { periodo: '2026-10' }, auxiliar, HOY);
    expect(resultado).toEqual({ idReporte: 1, periodo: '2026-10', cantidad: 2 });

    const [reporte] = baseDeDatos.reportes;
    expect(reporte).toMatchObject({ tipo: 'ausentismo', periodo: '2026-10', creadoPor: 'id-auxiliar' });
    expect(reporte.contenido.map((f) => [f.colaborador, f.diasEnPeriodo, f.estado])).toEqual([
      ['Luis Pérez', 4, 'registrada'],
      ['Ana Gómez', 3, 'transcrita'],
    ]);

    expect(enviados).toHaveLength(1);
    expect(enviados[0].to).toBe(DESTINATARIOS.sgsst);
    expect(enviados[0].subject).toBe('[SIGI] Reporte de ausentismo — 2026-10');
    expect(enviados[0].text).toContain('2 incapacidad(es), 7 día(s) de ausencia en el periodo.');
    expect(enviados[0].text).toContain('Luis Pérez · Enfermedad general · Nueva EPS · inicio 2026-09-28 · 7 día(s), 4 en el periodo · Registrada');
    expect(enviados[0].attachments).toBeUndefined();

    expect(await control.consultarReporte(1)).toMatchObject({ periodo: '2026-10', contenido: reporte.contenido });
  });

  it('un periodo sin incapacidades no guarda ni envía nada', async () => {
    await registrar('Ana Gómez', { fechaInicio: '2026-11-01', diasIncapacidad: 2 });
    const error = await control.generarReporte('ausentismo', { periodo: '2026-10' }, auxiliar, HOY).catch((e) => e);
    expect(error).toBeInstanceOf(ErrorDeValidacion);
    expect(error.errores).toEqual({ periodo: 'No hay incapacidades en 2026-10: no se generó el reporte.' });
    expect(baseDeDatos.reportes).toHaveLength(0);
    expect(enviados).toHaveLength(0);
  });

  it('un periodo no válido no consulta nada', async () => {
    const consultar = vi.spyOn(baseDeDatos, 'consultarDatosReporte');
    const error = await control.generarReporte('ausentismo', { periodo: '2026-12' }, auxiliar, HOY).catch((e) => e);
    expect(error.errores).toEqual({ periodo: 'El mes del reporte no puede ser futuro.' });
    expect(consultar).not.toHaveBeenCalled();
  });

  it('el mismo mes se puede volver a generar: queda un reporte nuevo con los datos del momento', async () => {
    await registrar('Ana Gómez', { fechaInicio: '2026-10-05', diasIncapacidad: 3 });
    await control.generarReporte('ausentismo', { periodo: '2026-10' }, auxiliar, HOY);
    await registrar('Luis Pérez', { fechaInicio: '2026-10-10', diasIncapacidad: 2 });
    await control.generarReporte('ausentismo', { periodo: '2026-10' }, auxiliar, HOY);
    expect(baseDeDatos.reportes.map((r) => r.contenido.length)).toEqual([1, 2]);
    const { recientes, periodoSugerido, periodoMaximo } = await control.prepararReportes(HOY);
    expect(recientes.map((r) => r.id)).toEqual([2, 1]);
    expect({ periodoSugerido, periodoMaximo }).toEqual({ periodoSugerido: '2026-10', periodoMaximo: '2026-11' });
  });

  it('un doble envío (mismo mes, mismo contenido, recién generado) no guarda otro ni vuelve a enviar', async () => {
    await registrar('Ana Gómez', { fechaInicio: '2026-10-05', diasIncapacidad: 3 });
    const primero = await control.generarReporte('ausentismo', { periodo: '2026-10' }, auxiliar, HOY);
    const segundo = await control.generarReporte('ausentismo', { periodo: '2026-10' }, auxiliar, HOY);
    expect(segundo.idReporte).toBe(primero.idReporte);
    expect(baseDeDatos.reportes).toHaveLength(1);
    expect(enviados).toHaveLength(1);
  });

  it('pasado el tiempo del doble envío, el mismo mes sí genera un reporte nuevo', async () => {
    await registrar('Ana Gómez', { fechaInicio: '2026-10-05', diasIncapacidad: 3 });
    await control.generarReporte('ausentismo', { periodo: '2026-10' }, auxiliar, HOY);
    const despues = crearControlIncapacidades({ baseDeDatos, correo, ahora: () => Date.now() + DOBLE_ENVIO_MS + 1000 });
    await despues.generarReporte('ausentismo', { periodo: '2026-10' }, auxiliar, HOY);
    expect(baseDeDatos.reportes).toHaveLength(2);
    expect(enviados).toHaveLength(2);
  });

  it('cuenta los colaboradores por id: dos personas con el mismo nombre son dos', async () => {
    await registrar('Ana Gómez', { fechaInicio: '2026-10-05', diasIncapacidad: 3 });
    await baseDeDatos.guardarIncapacidad(
      { colaborador: { nombre: 'Ana Gómez', correo: 'otra.ana@sigi.test' }, entidad: 2, tipo: 'enfermedad_general', fechaInicio: '2026-10-10', diasIncapacidad: 2, fechaRecepcion: '2026-10-10' },
      'id-receptor',
    );
    await control.generarReporte('ausentismo', { periodo: '2026-10' }, auxiliar, HOY);
    expect(totalesDelReporte(baseDeDatos.reportes[0].contenido).colaboradores).toBe(2);
  });

  it('si el correo al SG-SST falla, borra el reporte (502: se puede reintentar)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await registrar('Ana Gómez', { fechaInicio: '2026-10-05', diasIncapacidad: 3 });
    const fallido = crearControlIncapacidades({
      baseDeDatos,
      correo: { ...correo, enviarReporteAusentismo: async () => { throw new Error('SMTP caído'); } },
    });
    const error = await fallido.generarReporte('ausentismo', { periodo: '2026-10' }, auxiliar, HOY).catch((e) => e);
    expect(error).toBeInstanceOf(ErrorDeAviso);
    expect(error.deshecho).toBe(true);
    expect(baseDeDatos.reportes).toHaveLength(0);
  });

  it('si además no se puede borrar, lo dice (500)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await registrar('Ana Gómez', { fechaInicio: '2026-10-05', diasIncapacidad: 3 });
    baseDeDatos.eliminarReporte = async () => { throw new Error('BD caída'); };
    const fallido = crearControlIncapacidades({
      baseDeDatos,
      correo: { ...correo, enviarReporteAusentismo: async () => { throw new Error('SMTP caído'); } },
    });
    const error = await fallido.generarReporte('ausentismo', { periodo: '2026-10' }, auxiliar, HOY).catch((e) => e);
    expect(error.deshecho).toBe(false);
  });

  it('un tipo de reporte que no existe es un error de programación', async () => {
    await expect(control.generarReporte('otro', { periodo: '2026-10' }, auxiliar, HOY)).rejects.toThrow('Tipo de reporte no disponible');
  });
});

// HU-28 — reporte mensual de prolongadas por hito (DS-12 alternativa A1; DA-19, DA-49, DA-58).
const prolongada = (cambios = {}) => ({
  idIncapacidad: 1,
  idColaborador: 10,
  colaborador: 'Ana Gómez',
  tipo: 'enfermedad_general',
  entidad: 'Nueva EPS',
  fechaInicio: '2026-05-01',
  diasIncapacidad: 200,
  estado: 'transcrita',
  concepto: null,
  faltaConcepto: false,
  pagoSuspendido: false,
  ...cambios,
});

describe('HU-28 — corte y hito al corte (DA-49, DA-58)', () => {
  it('el corte es el fin del mes o, si el mes está en curso, el día en que se genera', () => {
    expect(corteDelPeriodo('2026-10', HOY)).toBe('2026-10-31');
    expect(corteDelPeriodo('2026-11', HOY)).toBe('2026-11-02');
    expect(corteDelReporte({ periodo: '2026-11', creadoEn: '2026-11-03T02:00:00Z' })).toBe('2026-11-02'); // 9 p. m. en Colombia
  });

  it('el hito es el más alto al que llegó por fecha, no solo por duración', () => {
    const i = prolongada(); // día 90: 2026-07-29 · 120: 08-28 · 150: 09-27 · 180: 10-27
    expect(hitoAlCorte(i, '2026-07-28')).toBeNull();
    expect(hitoAlCorte(i, '2026-07-29')).toBe(90);
    expect(hitoAlCorte(i, '2026-09-27')).toBe(150);
    expect(hitoAlCorte(i, '2026-10-31')).toBe(180);
    expect(hitoAlCorte(prolongada({ diasIncapacidad: 130 }), '2026-12-31')).toBe(120);
  });

  it('los grupos van del hito más alto al más bajo y terminan con las que aún no llegan al día 90', () => {
    expect(GRUPOS_HITO.map((g) => g.clave)).toEqual(['dia_180', 'dia_150', 'dia_120', 'dia_90', 'antes_90']);
    expect(GRUPOS_HITO.at(-1).nombre).toBe('Aún no llega al día 90');
  });
});

describe('HU-28 — clasificarPorHito (DS-12)', () => {
  const datos = [
    prolongada({ idIncapacidad: 1 }), // 2026-05-01, 200 días: llega al 180 el 2026-10-27
    prolongada({ idIncapacidad: 2, idColaborador: 11, colaborador: 'Luis Pérez', fechaInicio: '2026-10-20', diasIncapacidad: 95 }), // empieza en octubre
    prolongada({ idIncapacidad: 3, fechaInicio: '2026-10-01', diasIncapacidad: 60 }), // no es prolongada
    prolongada({ idIncapacidad: 4, fechaInicio: '2026-05-01', diasIncapacidad: 100 }), // terminó el 2026-08-08
    prolongada({ idIncapacidad: 5, idColaborador: 12, fechaInicio: '2026-06-15', diasIncapacidad: 130, concepto: true }), // llega al 120 el 2026-10-12 y termina el 10-22
    prolongada({ idIncapacidad: 6, fechaInicio: '2026-11-01', diasIncapacidad: 120 }), // empieza después del mes
  ];

  it('HU-28.CA1 — deja las de más de 90 días con algún día en el mes y las clasifica por el hito al corte', () => {
    const contenido = clasificarPorHito(datos, '2026-10', HOY);
    expect(contenido.map((f) => [f.idIncapacidad, f.hito, f.diaAlCorte])).toEqual([
      [1, 180, 184],
      [5, 120, 130],
      [2, null, 12],
    ]);
    expect(contenido[0]).toEqual({
      idIncapacidad: 1,
      idColaborador: 10,
      colaborador: 'Ana Gómez',
      tipo: 'enfermedad_general',
      entidad: 'Nueva EPS',
      fechaInicio: '2026-05-01',
      fechaFin: '2026-11-16',
      diasIncapacidad: 200,
      diaAlCorte: 184,
      hito: 180,
      hitosEnPeriodo: [{ dia: 180, fecha: '2026-10-27' }],
      estadoConcepto: 'pendiente',
      pagoSuspendido: false,
      estado: 'transcrita',
    });
    expect(contenido[1]).toMatchObject({ hitosEnPeriodo: [{ dia: 120, fecha: '2026-10-12' }], estadoConcepto: 'registrado' });
    expect(contenido[2].hitosEnPeriodo).toEqual([]);
  });

  it('no copia el texto del concepto al reporte', () => {
    const contenido = clasificarPorHito([prolongada({ concepto: 'Pronóstico favorable de rehabilitación' })], '2026-10', HOY);
    expect(JSON.stringify(contenido)).not.toContain('Pronóstico');
    expect(contenido[0].estadoConcepto).toBe('registrado');
  });

  it('en el mes en curso el corte es hoy: un hito que aún no llega se lista en el mes, pero no cuenta como alcanzado', () => {
    const contenido = clasificarPorHito([prolongada({ fechaInicio: '2026-08-08', diasIncapacidad: 120 })], '2026-11', HOY);
    expect(contenido[0]).toMatchObject({ hito: null, diaAlCorte: 87, hitosEnPeriodo: [{ dia: 90, fecha: '2026-11-05' }] });
  });

  it('una que empieza más adelante en el mes en curso aún no inicia (día 0)', () => {
    const contenido = clasificarPorHito([prolongada({ fechaInicio: '2026-11-20', diasIncapacidad: 120 })], '2026-11', HOY);
    expect(contenido[0]).toMatchObject({ hito: null, diaAlCorte: 0 });
  });

  it('agrupa por hito con los grupos vacíos y calcula los totales', () => {
    const contenido = clasificarPorHito(datos, '2026-10', HOY);
    expect(porHito(contenido).map((g) => [g.clave, g.filas.map((f) => f.idIncapacidad)])).toEqual([
      ['dia_180', [1]],
      ['dia_150', []],
      ['dia_120', [5]],
      ['dia_90', []],
      ['antes_90', [2]],
    ]);
    expect(totalesProlongadas(contenido)).toEqual({ incapacidades: 3, colaboradores: 3, conHitoEnMes: 2 });
  });
});

describe('HU-28 — generarReporte(prolongadas) (DS-12)', () => {
  it('HU-28.CA1 — consolida, clasifica, guarda con quién lo generó y no envía correos', async () => {
    const id = await registrar('Ana Gómez', { fechaInicio: '2026-05-01', diasIncapacidad: 200, estado: 'transcrita' });
    Object.assign(baseDeDatos.incapacidades.find((i) => i.idIncapacidad === id), { faltaConcepto: true, pagoSuspendido: true });
    await registrar('Luis Pérez', { fechaInicio: '2026-10-05', diasIncapacidad: 3 });

    const resultado = await control.generarReporte('prolongadas', { periodo: '2026-10' }, auxiliar, HOY);
    expect(resultado).toEqual({ idReporte: 1, periodo: '2026-10', cantidad: 1 });
    const [reporte] = baseDeDatos.reportes;
    expect(reporte).toMatchObject({ tipo: 'prolongadas', periodo: '2026-10', creadoPor: 'id-auxiliar' });
    expect(reporte.contenido).toEqual([
      expect.objectContaining({ idIncapacidad: id, hito: 180, estadoConcepto: 'falta', pagoSuspendido: true, estado: 'transcrita' }),
    ]);
    expect(enviados).toHaveLength(0);

    const { recientesProlongadas, recientes } = await control.prepararReportes(HOY);
    expect(recientesProlongadas.map((r) => r.id)).toEqual([1]);
    expect(recientes).toEqual([]);
  });

  it('un mes sin prolongadas no guarda nada (400)', async () => {
    await registrar('Luis Pérez', { fechaInicio: '2026-10-05', diasIncapacidad: 3 });
    const error = await control.generarReporte('prolongadas', { periodo: '2026-10' }, auxiliar, HOY).catch((e) => e);
    expect(error).toBeInstanceOf(ErrorDeValidacion);
    expect(error.errores).toEqual({ periodo: 'No hay incapacidades prolongadas en 2026-10: no se generó el reporte.' });
    expect(baseDeDatos.reportes).toHaveLength(0);
  });

  it('valida el periodo igual que el de ausentismo, sin consultar', async () => {
    const consultar = vi.spyOn(baseDeDatos, 'consultarDatosProlongadas');
    const error = await control.generarReporte('prolongadas', { periodo: '2019-12' }, auxiliar, HOY).catch((e) => e);
    expect(error.errores).toEqual({ periodo: 'Elija un mes desde 2020-01.' });
    expect(consultar).not.toHaveBeenCalled();
  });

  it('un doble envío devuelve el mismo reporte; un reporte de ausentismo del mismo mes no lo confunde', async () => {
    await registrar('Ana Gómez', { fechaInicio: '2026-05-01', diasIncapacidad: 200 });
    const ausentismo = await control.generarReporte('ausentismo', { periodo: '2026-10' }, auxiliar, HOY);
    const primero = await control.generarReporte('prolongadas', { periodo: '2026-10' }, auxiliar, HOY);
    const segundo = await control.generarReporte('prolongadas', { periodo: '2026-10' }, auxiliar, HOY);
    expect(primero.idReporte).not.toBe(ausentismo.idReporte);
    expect(segundo.idReporte).toBe(primero.idReporte);
    expect(baseDeDatos.reportes.map((r) => r.tipo)).toEqual(['ausentismo', 'prolongadas']);
  });

  it('si cambia el concepto, el mismo mes genera un reporte nuevo aunque sea enseguida', async () => {
    const id = await registrar('Ana Gómez', { fechaInicio: '2026-05-01', diasIncapacidad: 200 });
    await control.generarReporte('prolongadas', { periodo: '2026-10' }, auxiliar, HOY);
    baseDeDatos.incapacidades.find((i) => i.idIncapacidad === id).concepto = 'Concepto favorable de la EPS';
    await control.generarReporte('prolongadas', { periodo: '2026-10' }, auxiliar, HOY);
    expect(baseDeDatos.reportes.map((r) => r.contenido[0].estadoConcepto)).toEqual(['pendiente', 'registrado']);
  });
});
