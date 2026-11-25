// Grupo `registro` del Control (DS-01, CU-01) con la persistencia falsa.
import { beforeEach, describe, expect, it } from 'vitest';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { ErrorDeValidacion } from '../../src/controllers/error-de-validacion.js';
import { TIPOS_INCAPACIDAD } from '../../src/models/incapacidad.model.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { formularioDeRegistro } from '../helpers/fabricas.js';
import { USUARIOS } from '../helpers/sesion-falsa.js';

let baseDeDatos;
let control;

beforeEach(() => {
  baseDeDatos = crearBaseDeDatosFalsa();
  control = crearControlIncapacidades({ baseDeDatos });
});

const errorDe = async (cambios) => {
  const error = await control.registrarIncapacidad(formularioDeRegistro(cambios), USUARIOS.receptor).catch((e) => e);
  expect(error).toBeInstanceOf(ErrorDeValidacion);
  expect(baseDeDatos.incapacidades).toHaveLength(0);
  return error.errores;
};

describe('HU-03 — registrar incapacidad o licencia (Control)', () => {
  it('HU-03.CA1 — con los 6 datos la guarda y devuelve su identificador', async () => {
    const { idIncapacidad } = await control.registrarIncapacidad(formularioDeRegistro(), USUARIOS.receptor);
    expect(idIncapacidad).toBe(1);
    expect(baseDeDatos.incapacidades[0]).toMatchObject({
      idIncapacidad: 1,
      tipo: 'enfermedad_general',
      entidad: 2,
      fechaInicio: '2026-11-03',
      diasIncapacidad: 5,
      fechaRecepcion: '2026-11-04',
    });
    expect(baseDeDatos.colaboradores[0]).toMatchObject({ nombre: 'Ana María Gómez', correo: 'ana.gomez@sigi.test' });
  });

  it.each([
    ['colaborador', { colaborador: '   ' }],
    ['correoColaborador', { correoColaborador: 'sin-arroba' }],
    ['tipo', { tipo: '' }],
    ['entidad', { entidad: '' }],
    ['fechaInicio', { fechaInicio: '03/11/2026' }],
    ['diasIncapacidad', { diasIncapacidad: '0' }],
    ['diasIncapacidad', { diasIncapacidad: '2.5' }],
    ['fechaRecepcion', { fechaRecepcion: undefined }],
  ])('HU-03.CA1 — sin un %s válido no guarda y señala el campo', async (campo, cambios) => {
    expect(Object.keys(await errorDe(cambios))).toEqual([campo]);
  });

  it('HU-03.CA1 — la entidad debe ser una de las cargadas (DA-03)', async () => {
    expect(await errorDe({ entidad: '999' })).toEqual({ entidad: 'Elija una entidad de la lista.' });
  });

  it.each(TIPOS_INCAPACIDAD)('HU-03.CA3 — acepta el tipo %s', async (tipo) => {
    await control.registrarIncapacidad(formularioDeRegistro({ tipo }), USUARIOS.auxiliar);
    expect(baseDeDatos.incapacidades[0].tipo).toBe(tipo);
  });

  it('HU-03.CA3 — son exactamente 6 tipos y cualquier otro se rechaza', async () => {
    expect(TIPOS_INCAPACIDAD).toHaveLength(6);
    expect(await errorDe({ tipo: 'vacaciones' })).toHaveProperty('tipo');
  });

  it('HU-03.CA4 — queda sin estado y el formulario no puede fijarlo', async () => {
    await control.registrarIncapacidad(formularioDeRegistro({ estado: 'pagada', ibc: '5000000' }), USUARIOS.receptor);
    expect(baseDeDatos.incapacidades[0].estado).toBeNull();
    expect(baseDeDatos.incapacidades[0]).not.toHaveProperty('ibc');
  });

  it('DA-03 — crea el colaborador si no existe y lo reutiliza por su correo', async () => {
    await control.registrarIncapacidad(formularioDeRegistro(), USUARIOS.receptor);
    await control.registrarIncapacidad(
      formularioDeRegistro({ correoColaborador: '  ANA.Gomez@sigi.test ', fechaInicio: '2026-11-10' }),
      USUARIOS.auxiliar,
    );
    expect(baseDeDatos.colaboradores).toHaveLength(1);
    expect(baseDeDatos.incapacidades.map((i) => i.colaboradorId)).toEqual([1, 1]);
  });

  it('HU-03 — si guardar falla, el error llega a quien registra', async () => {
    const falla = new Error('Base de datos no disponible');
    baseDeDatos.guardarIncapacidad = async () => { throw falla; };
    await expect(control.registrarIncapacidad(formularioDeRegistro(), USUARIOS.receptor)).rejects.toBe(falla);
  });

  it('DA-23 — guarda el usuario que registró', async () => {
    await control.registrarIncapacidad(formularioDeRegistro(), USUARIOS.auxiliar);
    expect(baseDeDatos.incapacidades[0].creadoPor).toBe(USUARIOS.auxiliar.id);
    expect(baseDeDatos.colaboradores[0].creadoPor).toBe(USUARIOS.auxiliar.id);
  });
});
