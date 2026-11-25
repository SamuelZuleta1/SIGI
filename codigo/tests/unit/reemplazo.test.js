// Grupo `reemplazo` del Control (DS-02, CU-03) con la persistencia falsa.
import { beforeEach, describe, expect, it } from 'vitest';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { ErrorDeValidacion } from '../../src/controllers/error-de-validacion.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { formularioDeRegistro } from '../helpers/fabricas.js';
import { USUARIOS } from '../helpers/sesion-falsa.js';

let baseDeDatos;
let control;

beforeEach(async () => {
  baseDeDatos = crearBaseDeDatosFalsa();
  control = crearControlIncapacidades({ baseDeDatos });
  await control.registrarIncapacidad(formularioDeRegistro(), USUARIOS.receptor);
});

const errorDe = async (idIncapacidad, reemplazo) => {
  const error = await control.registrarReemplazo(idIncapacidad, reemplazo, USUARIOS.lider).catch((e) => e);
  expect(error).toBeInstanceOf(ErrorDeValidacion);
  return error.errores;
};

describe('HU-05 — registrar el reemplazo del colaborador (Control)', () => {
  it('HU-05.CA1 — guarda el reemplazo asociado a la incapacidad y lo devuelve para la confirmación', async () => {
    const resultado = await control.registrarReemplazo('1', '  Carlos Ruiz  ', USUARIOS.lider);
    expect(resultado).toEqual({ idIncapacidad: 1, reemplazo: 'Carlos Ruiz' });
    expect(baseDeDatos.reemplazos).toEqual([{ idIncapacidad: 1, reemplazo: 'Carlos Ruiz', creadoPor: USUARIOS.lider.id }]);
  });

  it.each([
    ['vacío', ''],
    ['solo espacios', '   '],
    ['ausente', undefined],
    ['de más de 200 letras', 'a'.repeat(201)],
  ])('HU-05.CA1 — con un nombre %s no guarda y señala el campo', async (_caso, nombre) => {
    expect(Object.keys(await errorDe('1', nombre))).toEqual(['reemplazo']);
    expect(baseDeDatos.reemplazos).toHaveLength(0);
  });

  it.each(['99', 'abc', '', '1 or 1=1', undefined])('HU-05.CA1 — la incapacidad «%s» no existe: no guarda', async (id) => {
    expect(await errorDe(id, 'Carlos Ruiz')).toEqual({ incapacidad: 'No hay una incapacidad con ese número.' });
    expect(baseDeDatos.reemplazos).toHaveLength(0);
  });

  it('HU-05.CA2 — un segundo registro sustituye al anterior: queda uno solo (DA-22)', async () => {
    await control.registrarReemplazo(1, 'Carlos Ruiz', USUARIOS.lider);
    await control.registrarReemplazo(1, 'Marta Lopera', USUARIOS.lider);
    expect(baseDeDatos.reemplazos).toHaveLength(1);
    expect(baseDeDatos.reemplazos[0].reemplazo).toBe('Marta Lopera');
  });

  it('HU-05.CA2 — un nombre inválido no borra el reemplazo que ya había', async () => {
    await control.registrarReemplazo(1, 'Carlos Ruiz', USUARIOS.lider);
    await errorDe(1, ' ');
    expect(baseDeDatos.reemplazos[0].reemplazo).toBe('Carlos Ruiz');
  });

  it('HU-05.CA2 — cada incapacidad tiene su propio reemplazo', async () => {
    await control.registrarIncapacidad(formularioDeRegistro({ fechaInicio: '2026-11-10' }), USUARIOS.receptor);
    await control.registrarReemplazo(1, 'Carlos Ruiz', USUARIOS.lider);
    await control.registrarReemplazo(2, 'Marta Lopera', USUARIOS.lider);
    expect(baseDeDatos.reemplazos.map((r) => [r.idIncapacidad, r.reemplazo])).toEqual([[1, 'Carlos Ruiz'], [2, 'Marta Lopera']]);
  });

  it('obtenerReemplazo — trae la incapacidad y su reemplazo actual, o null si el número no existe', async () => {
    expect(await control.obtenerReemplazo('1')).toMatchObject({ incapacidad: { idIncapacidad: 1 }, reemplazo: null });
    await control.registrarReemplazo(1, 'Carlos Ruiz', USUARIOS.lider);
    expect((await control.obtenerReemplazo(1)).reemplazo).toBe('Carlos Ruiz');
    expect(await control.obtenerReemplazo('99')).toBeNull();
  });
});
