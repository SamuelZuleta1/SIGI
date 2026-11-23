// HU-27 contra Supabase (nube): consultarDatosReporte (en bloques), guardarReporte con su contenido (jsonb, DA-21,
// DA-23), consultarReporte/consultarReportes y, si el envío al SG-SST falla, eliminarReporte.
// Requisitos: proyecto vinculado, migraciones aplicadas y `npm run db:usuarios`.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { crearClienteServidor } from '../../src/config/supabase.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { DOBLE_ENVIO_MS } from '../../src/controllers/reportes.controller.js';
import { ErrorDeAviso } from '../../src/controllers/error-de-aviso.js';
import { crearBaseDeDatos } from '../../src/persistence/base-de-datos.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { formularioDeRegistro } from '../helpers/fabricas.js';

const servidor = crearClienteServidor();
const baseDeDatos = crearBaseDeDatos(servidor);
const { correo, enviados } = crearCorreoFalso();
const control = crearControlIncapacidades({ baseDeDatos, correo });

// Un colaborador con nombre único y un mes antiguo, para encontrar (y borrar) solo lo que crea esta prueba.
const marca = Date.now();
const nombre = `Prueba Reporte ${marca}`;
const correoColaborador = `prueba.reporte.${marca}@sigi.test`;
const PERIODO = '2021-03';
const ids = [];
const reportes = [];
let auxiliar;

beforeAll(async () => {
  const usuarios = await servidor.from('usuario').select('id, correo, rol').in('correo', ['receptor1@sigi.test', 'auxiliar1@sigi.test']);
  const receptor = usuarios.data?.find((u) => u.rol === 'receptor');
  auxiliar = usuarios.data?.find((u) => u.rol === 'auxiliar');
  if (usuarios.error || !receptor || !auxiliar) throw new Error('Faltan los usuarios de demostración: ejecute `npm run db:usuarios`');
  // La tercera empezó más de un año antes del mes y dura 500 días: se lee por la consulta de las largas.
  for (const [fechaInicio, diasIncapacidad] of [['2021-02-25', 10], ['2021-03-15', 3], ['2020-01-10', 500]]) {
    const { idIncapacidad } = await control.registrarIncapacidad(
      formularioDeRegistro({ colaborador: nombre, correoColaborador, fechaInicio, diasIncapacidad: String(diasIncapacidad), fechaRecepcion: fechaInicio }),
      receptor,
    );
    ids.push(idIncapacidad);
  }
});

afterAll(async () => {
  if (reportes.length) await servidor.from('reporte').delete().in('id', reportes);
  if (ids.length) await servidor.from('incapacidad').delete().in('id', ids);
  await servidor.from('colaborador').delete().eq('correo', correoColaborador);
});

describe('HU-27 — reporte de ausentismo (persistencia real)', () => {
  it('HU-27.CA1 — consolida el mes, guarda el reporte con su contenido y quién lo generó, y lo envía', async () => {
    const { idReporte, periodo } = await control.generarReporte('ausentismo', { periodo: PERIODO }, auxiliar);
    reportes.push(idReporte);
    expect(periodo).toBe(PERIODO);

    const { data: fila } = await servidor.from('reporte').select('tipo, periodo, contenido, creado_por').eq('id', idReporte).single();
    expect(fila).toMatchObject({ tipo: 'ausentismo', periodo: PERIODO, creado_por: auxiliar.id });
    const propias = fila.contenido.filter((f) => f.colaborador === nombre);
    expect(propias.map((f) => [f.idIncapacidad, f.fechaInicio, f.diasIncapacidad, f.diasEnPeriodo, f.estado])).toEqual([
      [ids[2], '2020-01-10', 500, 31, 'registrada'],
      [ids[0], '2021-02-25', 10, 6, 'registrada'],
      [ids[1], '2021-03-15', 3, 3, 'registrada'],
    ]);
    expect(new Set(propias.map((f) => f.idColaborador)).size).toBe(1);
    expect(enviados.at(-1).subject).toBe(`[SIGI] Reporte de ausentismo — ${PERIODO}`);

    expect(await control.consultarReporte(idReporte)).toMatchObject({ id: idReporte, tipo: 'ausentismo', periodo: PERIODO, contenido: fila.contenido });
    const { recientes } = await control.prepararReportes();
    expect(recientes.some((r) => r.id === idReporte)).toBe(true);
  });

  it('un doble envío devuelve el reporte recién generado sin guardar otro (contenido jsonb comparado sin el orden de las claves)', async () => {
    const antes = enviados.length;
    const { idReporte } = await control.generarReporte('ausentismo', { periodo: PERIODO }, auxiliar);
    expect(idReporte).toBe(reportes[0]);
    expect(enviados.length).toBe(antes);
  });

  it('si el envío al SG-SST falla, el reporte se borra', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fallido = crearControlIncapacidades({
      baseDeDatos,
      ahora: () => Date.now() + DOBLE_ENVIO_MS + 1000,
      correo: { ...correo, enviarReporteAusentismo: async () => { throw new Error('SMTP caído'); } },
    });
    const { count: antes } = await servidor.from('reporte').select('id', { count: 'exact', head: true }).eq('periodo', PERIODO);
    const error = await fallido.generarReporte('ausentismo', { periodo: PERIODO }, auxiliar).catch((e) => e);
    expect(error).toBeInstanceOf(ErrorDeAviso);
    expect(error.deshecho).toBe(true);
    const { count: despues } = await servidor.from('reporte').select('id', { count: 'exact', head: true }).eq('periodo', PERIODO);
    expect(despues).toBe(antes);
  });

  it('un reporte que no existe es null', async () => {
    expect(await baseDeDatos.consultarReporte(999_999_999)).toBeNull();
  });
});
