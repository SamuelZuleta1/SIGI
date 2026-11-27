// Estadísticas e informes: cálculos del Control (puros) y control con persistencia falsa.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAXIMO_MESES,
  aCsv,
  calcularEstadisticas,
  carteraPendiente,
  celdaCsv,
  crearControlEstadisticas,
  delRango,
  diasDentro,
  filasCsv,
  indicadores,
  leerEntidad,
  leerRango,
  mesesDelRango,
  nombreArchivo,
  nombreRango,
  rangoAnterior,
  serieMensual,
  tiempoPromedioDePago,
  variacion,
} from '../../src/controllers/estadisticas.controller.js';
import { ErrorDeValidacion } from '../../src/controllers/error-de-validacion.js';
import { anchoRelativo, barraRedondeada, columnas, escalaRedonda } from '../../src/servicios/graficas.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';

const HOY = '2026-11-27';

const incapacidad = (datos) => ({
  idIncapacidad: 1,
  idColaborador: 1,
  colaborador: 'Ana',
  idEntidad: 2,
  entidad: 'Nueva EPS',
  tipo: 'enfermedad_general',
  fechaInicio: '2026-10-05',
  diasIncapacidad: 3,
  estado: 'registrada',
  ...datos,
});

describe('rango de meses', () => {
  it('sin desde ni hasta usa los últimos 6 meses con el mes en curso', () => {
    expect(leerRango({}, HOY)).toMatchObject({ valor: { desde: '2026-06', hasta: '2026-11' }, errores: {} });
  });

  it.each([
    [{ desde: '2026-13', hasta: '2026-11' }, 'desde', 'Escriba el mes como AAAA-MM, por ejemplo 2026-10.'],
    [{ desde: '2026-01', hasta: '2026-12' }, 'hasta', 'El mes no puede ser futuro.'],
    [{ desde: '2019-12', hasta: '2026-01' }, 'desde', 'Elija un mes desde 2020-01.'],
    [{ desde: '2026-05', hasta: '2026-04' }, 'hasta', 'Debe ser igual o posterior al mes inicial.'],
    [{ desde: '2024-01', hasta: '2026-01' }, 'hasta', `El rango puede tener hasta ${MAXIMO_MESES} meses.`],
    [{ desde: '2026-01' }, 'hasta', 'Elija el mes.'],
  ])('%o → error en «%s»', (consulta, campo, mensaje) => {
    const { valor, errores } = leerRango(consulta, HOY);
    expect(valor).toBeUndefined();
    expect(errores[campo]).toBe(mensaje);
  });

  it('acepta un rango de exactamente 24 meses', () => {
    expect(leerRango({ desde: '2024-12', hasta: '2026-11' }, HOY).valor).toEqual({ desde: '2024-12', hasta: '2026-11' });
  });

  it('los meses del rango, el anterior del mismo largo y su nombre', () => {
    expect(mesesDelRango({ desde: '2025-11', hasta: '2026-02' })).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(rangoAnterior({ desde: '2026-06', hasta: '2026-11' })).toEqual({ desde: '2025-12', hasta: '2026-05' });
    expect(nombreRango({ desde: '2026-06', hasta: '2026-11' })).toBe('jun – nov 2026');
    expect(nombreRango({ desde: '2025-11', hasta: '2026-02' })).toBe('nov 2025 – feb 2026');
    expect(nombreRango({ desde: '2026-11', hasta: '2026-11' })).toBe('nov 2026');
  });

  it('la entidad debe estar en la lista', () => {
    const entidades = [{ id: 2, nombre: 'Nueva EPS' }];
    expect(leerEntidad('', entidades)).toEqual({ valor: null, texto: '' });
    expect(leerEntidad('2', entidades).valor).toEqual(entidades[0]);
    expect(leerEntidad('99', entidades).error).toBe('Elija una entidad de la lista.');
  });
});

describe('cálculos', () => {
  it('cuenta solo los días del certificado dentro del rango (como el reporte de ausentismo)', () => {
    const i = incapacidad({ fechaInicio: '2026-09-28', diasIncapacidad: 7 }); // 28 sept – 4 oct
    expect(diasDentro(i, '2026-10-01', '2026-10-31')).toBe(4);
    expect(diasDentro(i, '2026-09-01', '2026-09-30')).toBe(3);
    expect(diasDentro(i, '2026-11-01', '2026-11-30')).toBe(0);
    expect(delRango([i], '2026-11-01', '2026-11-30')).toEqual([]);
  });

  it('indicadores: días, colaboradores, recaudo en centavos, tasas y prolongadas', () => {
    const filas = [
      incapacidad({ idIncapacidad: 1, estado: 'pagada', fechaCobrada: '2026-10-10' }),
      incapacidad({ idIncapacidad: 2, idColaborador: 2, colaborador: 'Luis', estado: 'rechazada', diasIncapacidad: 10 }),
      incapacidad({ idIncapacidad: 3, estado: 'cobrada', diasIncapacidad: 120, diasAcumulados: 120, fechaInicio: '2026-08-01' }),
      incapacidad({ idIncapacidad: 4, estado: 'registrada', fechaInicio: '2026-12-01' }), // fuera del rango
    ];
    const pagos = [
      { idPago: 1, idIncapacidad: 1, valor: '100000.50', fechaPago: '2026-10-30', fechaCobrada: '2026-10-10' },
      { idPago: 2, idIncapacidad: 1, valor: '50000.00', fechaPago: '2026-11-02', fechaCobrada: '2026-10-10' },
      { idPago: 3, idIncapacidad: 9, valor: '1.00', fechaPago: '2026-09-30' }, // fuera del rango
    ];
    const r = indicadores(filas, pagos, '2026-10-01', '2026-11-30');
    expect(r).toMatchObject({
      incapacidades: 3,
      colaboradores: 2,
      recaudado: 15000050,
      pagos: 2,
      tiempoPago: 20, // 10 oct → 30 oct (el primer pago)
      respondidas: 3,
      prolongadas: 1,
    });
    expect(r.diasAusencia).toBe(3 + 10 + 59); // la prolongada va del 1 ago al 28 nov: 31 días de oct + 28 de nov
    expect(r.tasaRechazo).toBeCloseTo(1 / 3);
    expect(r.tasaPagadas).toBeCloseTo(1 / 3);
  });

  it('sin respuestas ni pagos, las tasas y el tiempo de pago quedan en null', () => {
    const r = indicadores([incapacidad()], [], '2026-10-01', '2026-10-31');
    expect(r).toMatchObject({ tasaRechazo: null, tasaPagadas: null, tiempoPago: null, recaudado: 0 });
    expect(tiempoPromedioDePago([{ idIncapacidad: 1, fechaPago: '2026-10-01', fechaCobrada: null }])).toBeNull();
  });

  it('variación frente al periodo anterior', () => {
    expect(variacion(15, 10)).toEqual({ fraccion: 0.5, sube: true, igual: false });
    expect(variacion(5, 10)).toEqual({ fraccion: 0.5, sube: false, igual: false });
    expect(variacion(10, 0)).toBeNull();
  });

  it('serie mensual: incapacidades, nuevas, días y recaudo por mes', () => {
    const serie = serieMensual(
      [incapacidad({ fechaInicio: '2026-09-28', diasIncapacidad: 7 })],
      [{ idPago: 1, idIncapacidad: 1, valor: '2000.00', fechaPago: '2026-10-15' }],
      { desde: '2026-09', hasta: '2026-10' },
    );
    expect(serie).toEqual([
      { mes: '2026-09', incapacidades: 1, nuevas: 1, dias: 3, recaudado: 0 },
      { mes: '2026-10', incapacidades: 1, nuevas: 0, dias: 4, recaudado: 200000 },
    ]);
  });

  it('cartera: días desde la cuenta de cobro por tramo y vencidas con el plazo prometido', () => {
    const c = carteraPendiente(
      [
        { idIncapacidad: 1, fechaCobrada: '2026-11-20', tiempoPago: '30' },
        { idIncapacidad: 2, fechaCobrada: '2026-09-01', tiempoPago: 30 },
        { idIncapacidad: 3, fechaCobrada: '2026-01-02', tiempoPago: null },
        { idIncapacidad: 4, fechaCobrada: null, tiempoPago: null },
      ],
      HOY,
    );
    expect(c.total).toBe(4);
    expect(c.vencidas).toBe(1);
    expect(c.sinFecha).toBe(1);
    expect(Object.fromEntries(c.tramos.map((t) => [t.clave, t.cantidad]))).toEqual({ '0-30': 1, '31-60': 0, '61-90': 1, '91-180': 0, 'mas-180': 1 });
    expect(c.filas.map((f) => f.idIncapacidad)).toEqual([3, 2, 1, 4]); // de la más antigua a la más reciente
  });

  it('el filtro de entidad se aplica a incapacidades, pagos y cartera', () => {
    const e = calcularEstadisticas(
      {
        incapacidades: [incapacidad({ idIncapacidad: 1, idEntidad: 1, entidad: 'ARL SURA' }), incapacidad({ idIncapacidad: 2 })],
        pagos: [{ idPago: 1, idIncapacidad: 1, idEntidad: 1, entidad: 'ARL SURA', valor: '10.00', fechaPago: '2026-10-20' }],
        cobradas: [{ idIncapacidad: 3, entidad: 'ARL SURA', fechaCobrada: '2026-10-01', tiempoPago: 30 }],
      },
      { desde: '2026-10', hasta: '2026-10' },
      { entidad: { id: 2, nombre: 'Nueva EPS' }, hoy: HOY },
    );
    expect(e.indicadores.incapacidades).toBe(1);
    expect(e.indicadores.recaudado).toBe(0);
    expect(e.cartera.total).toBe(0);
    expect(e.entidades.map((x) => x.entidad)).toEqual(['Nueva EPS']);
  });
});

describe('CSV', () => {
  it('protege contra fórmulas, escapa comillas y usa coma decimal', () => {
    expect(celdaCsv('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(celdaCsv('+57 300')).toBe("'+57 300");
    expect(celdaCsv('Ana; Gómez')).toBe('"Ana; Gómez"');
    expect(celdaCsv(16.1)).toBe('16,1');
    expect(celdaCsv(null)).toBe('');
  });

  it('para Excel en español: BOM, punto y coma y CRLF', () => {
    expect(aCsv([['a', 1], ['b', 2]])).toBe('\uFEFFa;1\r\nb;2\r\n');
  });
});

describe('gráficas', () => {
  it('escala redonda para el eje', () => {
    expect(escalaRedonda(116)).toEqual({ tope: 200, paso: 50 });
    expect(escalaRedonda(9)).toEqual({ tope: 10, paso: 2.5 });
    expect(escalaRedonda(0)).toEqual({ tope: 4, paso: 1 });
  });

  it('barra con la base recta y el extremo redondeado; sin altura no se dibuja', () => {
    expect(barraRedondeada(0, 10, 20, 50)).toBe('M0,60V14Q0,10 4,10H16Q20,10 20,14V60Z');
    expect(barraRedondeada(0, 10, 20, 0)).toBe('');
  });

  it('columnas: etiqueta de valor solo en el máximo y en el último punto', () => {
    const g = columnas([{ etiqueta: 'a', valor: 3 }, { etiqueta: 'b', valor: 9 }, { etiqueta: 'c', valor: 1 }, { etiqueta: 'd', valor: 2 }]);
    expect(g.barras.map((b) => b.etiquetada)).toEqual([false, true, false, true]);
    expect(g.guias.at(-1).texto).toBe('10');
  });

  it('ancho relativo de una barra horizontal', () => {
    expect(anchoRelativo(5, 10)).toBe(50);
    expect(anchoRelativo(0, 10)).toBe(0);
    expect(anchoRelativo(1, 1000)).toBe(1.5); // un valor pequeño se sigue viendo
  });
});

describe('control de estadísticas (persistencia falsa)', () => {
  let baseDeDatos;
  let control;

  beforeEach(async () => {
    baseDeDatos = crearBaseDeDatosFalsa();
    control = crearControlEstadisticas({ baseDeDatos });
    const id = await baseDeDatos.guardarIncapacidad(
      { colaborador: { nombre: 'Ana Gómez', correo: 'ana@sigi.test' }, entidad: 2, tipo: 'enfermedad_general', fechaInicio: '2026-10-05', diasIncapacidad: 3, fechaRecepcion: '2026-10-06' },
      'id-receptor',
    );
    Object.assign(baseDeDatos.incapacidades[id - 1], { estado: 'pagada', fechaCobrada: '2026-10-08', tiempoPago: 30 });
    baseDeDatos.pagos.push({ idPago: 1, idIncapacidad: id, valor: '250000.00', fechaPago: '2026-10-28', conciliado: false });
    baseDeDatos.pagos.push({ idPago: 2, idIncapacidad: id, valor: '1.00', fechaPago: '2026-10-29', conciliado: false, anulacion: { motivo: 'mal digitado' } });
  });

  it('consultarEstadisticas: indicadores del rango sin contar los pagos anulados', async () => {
    const r = await control.consultarEstadisticas({ desde: '2026-10', hasta: '2026-10' }, HOY);
    expect(r.errores).toEqual({});
    expect(r.estadisticas.indicadores).toMatchObject({ incapacidades: 1, diasAusencia: 3, recaudado: 25000000, pagos: 1, tiempoPago: 20 });
  });

  it('consultarEstadisticas con filtros no válidos: errores y sin estadísticas', async () => {
    const r = await control.consultarEstadisticas({ desde: '2026-10', hasta: '2026-09', entidad: '77' }, HOY);
    expect(r.estadisticas).toBeNull();
    expect(Object.keys(r.errores).sort()).toEqual(['entidad', 'hasta']);
  });

  it('generarInforme: tipo desconocido es un error de validación', async () => {
    await expect(control.generarInforme({ tipo: 'otro' }, { id: 'id-auxiliar', correo: 'a@sigi.test' }, HOY)).rejects.toBeInstanceOf(ErrorDeValidacion);
  });

  it('generarInforme de detalle: filas para el CSV y nombre del archivo', async () => {
    const informe = await control.generarInforme(
      { tipo: 'detalle', desde: '2026-10', hasta: '2026-10', formato: 'csv' },
      { id: 'id-auxiliar', correo: 'auxiliar@sigi.test' },
      HOY,
      new Date('2026-11-27T15:00:00Z'),
    );
    expect(informe.formato).toBe('csv');
    expect(nombreArchivo(informe)).toBe('sigi-detalle-2026-10_2026-10.csv');
    const filas = filasCsv(informe);
    expect(filas).toContainEqual([1, 'Ana Gómez', 'Enfermedad general', 'Nueva EPS', '2026-10-05', '2026-10-07', 3, 3, 'Pagada', '2026-10-06', '2026-10-08']);
  });

  it('generarInforme de cartera: no usa el rango (aunque llegue uno no válido) y el archivo lleva la fecha de corte', async () => {
    const informe = await control.generarInforme({ tipo: 'cartera', desde: 'xx', hasta: 'yy' }, { id: 'id-auxiliar', correo: 'a@sigi.test' }, HOY);
    expect(nombreArchivo(informe)).toBe(`sigi-cartera-${HOY}.csv`);
  });
});
