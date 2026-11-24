// HU-25 contra Supabase (nube): guardarPagosConsignados guarda toda la lista en una sentencia (numeric(14,2), DA-23)
// y, si el aviso al auxiliar falla, eliminarPagosConsignados la deshace.
// Requisitos: proyecto vinculado, migraciones aplicadas y `npm run db:usuarios`.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { crearClienteServidor } from '../../src/config/supabase.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { ErrorDeAviso } from '../../src/controllers/error-de-aviso.js';
import { crearBaseDeDatos } from '../../src/persistence/base-de-datos.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';

const servidor = crearClienteServidor();
const baseDeDatos = crearBaseDeDatos(servidor);
const { correo, enviados } = crearCorreoFalso();
const control = crearControlIncapacidades({ baseDeDatos, correo });

// Nombres únicos para encontrar (y borrar) solo lo que crea esta prueba.
const marca = `Prueba HU-25 ${Date.now()}`;
let contabilidad;
let entidad;

const guardados = async () =>
  (await servidor.from('pago_consignado').select('entidad_id, colaborador, dias_pagados, valor, creado_por').like('colaborador', `${marca}%`).order('id')).data;

beforeAll(async () => {
  const { data, error } = await servidor.from('usuario').select('id, correo, rol').eq('correo', 'contabilidad1@sigi.test').maybeSingle();
  if (error || !data) throw new Error('Faltan los usuarios de demostración: ejecute `npm run db:usuarios`');
  contabilidad = data;
  [entidad] = await baseDeDatos.consultarEntidades();
});

afterAll(async () => {
  await servidor.from('pago_consignado').delete().like('colaborador', `${marca}%`);
});

describe('HU-25 — pagos consignados (persistencia real)', () => {
  it('HU-25.CA1 — guarda la lista con quién la registró y la muestra entre las recientes', async () => {
    const resultado = await control.registrarPagosConsignados(
      { entidad: String(entidad.id), colaborador: [`${marca} A`, `${marca} B`], dias: ['10', '3'], valor: ['1.250.000', '420.000,50'] },
      contabilidad,
    );
    expect(resultado.cantidad).toBe(2);
    expect(await guardados()).toEqual([
      { entidad_id: entidad.id, colaborador: `${marca} A`, dias_pagados: 10, valor: 1250000, creado_por: contabilidad.id },
      { entidad_id: entidad.id, colaborador: `${marca} B`, dias_pagados: 3, valor: 420000.5, creado_por: contabilidad.id },
    ]);
    expect(enviados.at(-1).subject).toBe(`[SIGI] Pagos por identificar — ${entidad.nombre}`);
    const { recientes, confirmacion } = await control.prepararPagosConsignados({ cantidad: '2', entidad: String(entidad.id) });
    expect(recientes.slice(0, 2).map((p) => p.colaborador).sort()).toEqual([`${marca} A`, `${marca} B`]);
    expect(confirmacion).toMatchObject({ entidad: entidad.nombre, cantidad: 2, total: 167_000_050 });
  });

  it('si el aviso falla, la lista se borra completa', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const antes = (await guardados()).length;
    const fallido = crearControlIncapacidades({
      baseDeDatos,
      correo: { ...correo, notificarPagosPorIdentificar: async () => { throw new Error('SMTP caído'); } },
    });
    const error = await fallido
      .registrarPagosConsignados({ entidad: String(entidad.id), colaborador: [`${marca} C`], dias: ['5'], valor: ['900.000'] }, contabilidad)
      .catch((e) => e);
    expect(error).toBeInstanceOf(ErrorDeAviso);
    expect(error.deshecho).toBe(true);
    expect(await guardados()).toHaveLength(antes);
  });

  it('la base de datos rechaza días o valor no positivos (restricciones de la tabla)', async () => {
    await expect(baseDeDatos.guardarPagosConsignados(entidad.id, [{ colaborador: `${marca} D`, diasPagados: 0, valor: '1.00' }], contabilidad.id))
      .rejects.toMatchObject({ code: '23514' });
    expect((await guardados()).some((p) => p.colaborador === `${marca} D`)).toBe(false);
  });
});
