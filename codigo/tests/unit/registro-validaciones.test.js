// Auditoría de las HU (pendientes) — validaciones del registro (HU-03) y fecha de nacimiento de las licencias (HU-12),
// con la persistencia falsa y hoy fijo.
import { beforeEach, describe, expect, it } from 'vitest';
import { calcularVencimientos } from '../../src/controllers/alertas.controller.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { ErrorDeValidacion } from '../../src/controllers/error-de-validacion.js';
import { erroresDeFechas, errorDeNacimiento, mismoNombre, tipoDeEntidadPara } from '../../src/controllers/registro.controller.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { formularioDeRegistro } from '../helpers/fabricas.js';
import { USUARIOS } from '../helpers/sesion-falsa.js';

const HOY = '2026-11-20';
let baseDeDatos;
let control;

beforeEach(() => {
  baseDeDatos = crearBaseDeDatosFalsa();
  control = crearControlIncapacidades({ baseDeDatos, correo: crearCorreoFalso().correo, hoy: () => HOY });
});

const registrar = (cambios) => control.registrarIncapacidad(formularioDeRegistro(cambios), USUARIOS.receptor);
const errores = async (cambios) => {
  const antes = baseDeDatos.incapacidades.length;
  const error = await registrar(cambios).catch((e) => e);
  expect(error).toBeInstanceOf(ErrorDeValidacion);
  expect(baseDeDatos.incapacidades).toHaveLength(antes); // no guardó nada
  return error.errores;
};

describe('HU-03 (auditoría) — fechas de recepción e inicio', () => {
  it('la recepción no puede ser futura; hoy sí', async () => {
    expect((await errores({ fechaInicio: '2026-11-18', fechaRecepcion: '2026-11-21' })).fechaRecepcion).toMatch(/posterior a hoy/);
    await expect(registrar({ fechaInicio: '2026-11-18', fechaRecepcion: HOY })).resolves.toEqual({ idIncapacidad: 1 });
  });

  it('la recepción no puede ser anterior al inicio; el mismo día sí', async () => {
    expect((await errores({ fechaInicio: '2026-11-10', fechaRecepcion: '2026-11-09' })).fechaRecepcion).toMatch(/anterior a la fecha de inicio/);
    await expect(registrar({ fechaInicio: '2026-11-10', fechaRecepcion: '2026-11-10' })).resolves.toEqual({ idIncapacidad: 1 });
  });

  it('el inicio no puede ser futuro: la recepción de hoy quedaría antes del inicio', async () => {
    const e = await errores({ fechaInicio: '2026-11-25', fechaRecepcion: HOY });
    expect(e.fechaRecepcion).toMatch(/anterior a la fecha de inicio/);
    // Ni con la recepción también futura, ni años después.
    expect((await errores({ fechaInicio: '2030-01-01', fechaRecepcion: '2030-01-02' })).fechaRecepcion).toMatch(/posterior a hoy/);
  });

  it('el inicio no puede ser anterior a hoy − 3 años (prescripción); el límite exacto sí', async () => {
    const e = await errores({ fechaInicio: '2023-11-19', fechaRecepcion: '2023-11-20' });
    expect(e.fechaInicio).toBe('La fecha de inicio no puede ser anterior al 20 nov 2023: después de 3 años ya no se puede cobrar.');
    await expect(registrar({ fechaInicio: '2023-11-20', fechaRecepcion: '2023-11-21' })).resolves.toEqual({ idIncapacidad: 1 });
  });

  it('erroresDeFechas: un 29 de febrero menos 3 años cae en el 28', () => {
    expect(erroresDeFechas({ fechaInicio: '2025-02-27', fechaRecepcion: '2025-02-28' }, '2028-02-29').fechaInicio).toMatch(/28 feb 2025/);
    expect(erroresDeFechas({ fechaInicio: '2025-02-28', fechaRecepcion: '2025-02-28' }, '2028-02-29')).toEqual({});
  });

  it('una prórroga tampoco admite la recepción futura ni anterior a su inicio', async () => {
    await registrar({ fechaInicio: '2026-11-01', diasIncapacidad: '10' }); // termina el 10
    const prorrogar = (fechaRecepcion) =>
      control.registrarProrroga('1', { fechaInicio: '2026-11-11', diasIncapacidad: '5', fechaRecepcion }, USUARIOS.receptor).catch((e) => e);
    expect((await prorrogar('2026-11-21')).errores.fechaRecepcion).toMatch(/posterior a hoy/);
    expect((await prorrogar('2026-11-10')).errores.fechaRecepcion).toMatch(/anterior a la fecha de inicio/);
    await expect(prorrogar('2026-11-12')).resolves.toEqual({ idIncapacidad: 2 });
  });
});

describe('HU-03 (auditoría) — el tipo debe ser coherente con la entidad', () => {
  it('tipoDeEntidadPara: lo laboral a la ARL; lo demás, a la EPS', () => {
    expect(tipoDeEntidadPara('accidente_laboral')).toBe('ARL');
    expect(tipoDeEntidadPara('enfermedad_laboral')).toBe('ARL');
    for (const tipo of ['enfermedad_general', 'accidente_transito', 'licencia_maternidad', 'licencia_paternidad']) {
      expect(tipoDeEntidadPara(tipo)).toBe('EPS');
    }
  });

  it.each(['accidente_laboral', 'enfermedad_laboral'])('%s ante una EPS se rechaza', async (tipo) => {
    expect((await errores({ tipo, entidad: '2' })).entidad).toMatch(/ante la ARL/);
  });

  it.each([
    ['enfermedad_general', {}],
    ['accidente_transito', {}],
    ['licencia_maternidad', { fechaNacimiento: '2026-11-03' }],
    ['licencia_paternidad', { fechaNacimiento: '2026-11-03' }],
  ])('%s ante la ARL se rechaza', async (tipo, extra) => {
    expect((await errores({ tipo, entidad: '1', ...extra })).entidad).toMatch(/ante la EPS/);
  });

  it('lo laboral ante la ARL y lo común ante la EPS se registran', async () => {
    await registrar({ tipo: 'accidente_laboral', entidad: '1' });
    await registrar({ tipo: 'enfermedad_general', entidad: '3' });
    expect(baseDeDatos.incapacidades).toHaveLength(2);
  });
});

describe('HU-03 (auditoría) — duplicados', () => {
  it('mismo colaborador, tipo, inicio y días: no se registra dos veces y dice cuál existe', async () => {
    await registrar();
    expect((await errores()).duplicada).toBe(
      'Ya está registrada la incapacidad n.º 1 de este colaborador, con el mismo tipo y las mismas fechas: no se registra dos veces.',
    );
    // El mismo correo escrito distinto también es el mismo colaborador.
    expect(await errores({ correoColaborador: ' ANA.GOMEZ@sigi.test ' })).toHaveProperty('duplicada');
  });

  it.each([
    ['otros días', { diasIncapacidad: '6' }],
    ['otro inicio', { fechaInicio: '2026-11-04' }],
    ['otro tipo', { tipo: 'accidente_transito' }],
    ['otro colaborador', { colaborador: 'Luis Gil', correoColaborador: 'luis@sigi.test' }],
  ])('con %s no es duplicado', async (_caso, cambios) => {
    await registrar();
    await expect(registrar(cambios)).resolves.toEqual({ idIncapacidad: 2 });
  });
});

describe('HU-03 (auditoría, decisión 1A) — el correo ya existe con otro nombre', () => {
  beforeEach(async () => {
    await registrar({ colaborador: 'Ana María Gómez Ríos', fechaInicio: '2026-10-01' });
  });

  it('no registra en silencio: señala el nombre guardado y pide confirmarlo', async () => {
    const e = await errores({ colaborador: 'Ana Gómez' });
    expect(e.colaborador).toBe('Ese correo ya es de «Ana María Gómez Ríos». Si es la misma persona, marque «Usar el nombre guardado»; si no, revise el correo.');
    expect(e.nombreGuardado).toBe('Ana María Gómez Ríos');
  });

  it('con «Usar el nombre guardado» registra con el guardado y no lo cambia', async () => {
    await registrar({ colaborador: 'Ana Gómez', usarNombreGuardado: 'si' });
    expect(baseDeDatos.colaboradores).toHaveLength(1);
    expect(baseDeDatos.colaboradores[0].nombre).toBe('Ana María Gómez Ríos');
    expect(baseDeDatos.incapacidades.map((i) => i.colaboradorId)).toEqual([1, 1]);
  });

  it('mayúsculas y espacios de más no son otro nombre', async () => {
    await expect(registrar({ colaborador: '  ana maría   GÓMEZ ríos ' })).resolves.toEqual({ idIncapacidad: 2 });
    expect(mismoNombre('Ana  María', 'ana maría')).toBe(true);
    expect(mismoNombre('Ana Maria', 'Ana María')).toBe(false); // una tilde sí cambia el nombre: se confirma
  });

  it('si el nombre y el duplicado fallan a la vez, se dicen los dos', async () => {
    const e = await errores({ colaborador: 'Ana Gómez', fechaInicio: '2026-10-01' });
    expect(Object.keys(e).sort()).toEqual(['colaborador', 'duplicada', 'nombreGuardado']);
  });
});

describe('HU-03 (auditoría) — la base rechaza lo que se cruzó entre la consulta y el guardado', () => {
  const rechazo = (code) => {
    baseDeDatos.guardarIncapacidad = async () => {
      throw Object.assign(new Error('rechazada'), { code });
    };
  };

  it('SG020: otro registro creó el colaborador con otro nombre', async () => {
    rechazo('SG020');
    baseDeDatos.consultarColaboradorPorCorreo = async () => null; // la consulta no lo vio; al explicar, ya existe
    const error = await registrar().catch((e) => e);
    expect(error).toBeInstanceOf(ErrorDeValidacion);
    expect(error.errores).toHaveProperty('colaborador');
  });

  it.each([
    ['SG021', 'entidad'],
    ['SG022', 'fechaRecepcion'],
    ['SG023', 'fechaNacimiento'],
    ['23505', 'duplicada'],
  ])('%s se explica en %s', async (code, campo) => {
    rechazo(code);
    expect((await registrar().catch((e) => e)).errores).toHaveProperty(campo);
  });

  it('cualquier otro error llega tal cual', async () => {
    rechazo('XX000');
    const error = await registrar().catch((e) => e);
    expect(error).not.toBeInstanceOf(ErrorDeValidacion);
    expect(error.code).toBe('XX000');
  });
});

describe('HU-03 (auditoría) — la alerta de «llegó tarde» ya no sale con fechas futuras', () => {
  const incapacidad = (cambios) => ({
    idIncapacidad: 1,
    colaborador: 'Ana',
    tipo: 'enfermedad_general',
    fechaInicio: '2026-11-03',
    diasIncapacidad: 5,
    fechaRecepcion: '2026-11-04',
    fechaNacimiento: null,
    estado: null,
    documentacionCompleta: null,
    entidad: { nombre: 'Nueva EPS', plazoTranscripcion: '1 year', plazoTranscripcionTransito: null },
    ...cambios,
  });
  const envio = (cambios) => calcularVencimientos([incapacidad(cambios)], HOY).filter((a) => a.tipo === 'envio');

  it('un dato antiguo con recepción futura no produce «llegó tarde»', () => {
    expect(envio({ fechaInicio: '2026-11-03', fechaRecepcion: '2030-01-01' })).toEqual([]);
  });

  it('el registro no deja crear ese dato', async () => {
    expect((await errores({ fechaInicio: '2026-11-03', fechaRecepcion: '2030-01-01' })).fechaRecepcion).toMatch(/posterior a hoy/);
  });

  it('una llegada tarde real (hasta hoy) sigue alertando', () => {
    expect(envio({ fechaInicio: '2026-11-10', fechaRecepcion: HOY })).toEqual([
      expect.objectContaining({ estado: 'vencido', diasTarde: 8 }),
    ]);
  });
});

describe('HU-12 (auditoría) — fecha de nacimiento de las licencias', () => {
  const licencia = (tipo, fechaInicio, fechaNacimiento) => ({ tipo, fechaInicio, fechaNacimiento, diasIncapacidad: '14' });

  it.each(['licencia_paternidad', 'licencia_maternidad'])('%s sin fecha de nacimiento no se registra', async (tipo) => {
    expect((await errores({ ...licencia(tipo, '2026-11-10'), fechaNacimiento: '' })).fechaNacimiento).toMatch(/Escriba la fecha de nacimiento/);
  });

  it('no puede ser futura', async () => {
    expect((await errores(licencia('licencia_paternidad', '2026-11-18', '2026-11-21'))).fechaNacimiento).toMatch(/posterior a hoy/);
  });

  it('paternidad: la licencia empieza entre el nacimiento y 30 días después (extremos incluidos)', async () => {
    expect((await errores(licencia('licencia_paternidad', '2026-11-09', '2026-11-10'))).fechaNacimiento).toMatch(/del 10 nov 2026 al 10 dic 2026/);
    expect(errorDeNacimiento(licencia('licencia_paternidad', '2026-11-09', '2026-10-10'), HOY)).toBeNull(); // nacimiento + 30
    expect(errorDeNacimiento(licencia('licencia_paternidad', '2026-11-10', '2026-10-10'), HOY)).toMatch(/del 10 oct 2026 al 9 nov 2026/);
    await registrar(licencia('licencia_paternidad', '2026-11-10', '2026-11-10'));
    expect(baseDeDatos.incapacidades[0].fechaNacimiento).toBe('2026-11-10');
  });

  it('maternidad: empieza entre 2 semanas antes del nacimiento y el día del nacimiento', async () => {
    expect(errorDeNacimiento(licencia('licencia_maternidad', '2026-11-01', '2026-11-15'), HOY)).toBeNull(); // 14 días antes
    expect(errorDeNacimiento(licencia('licencia_maternidad', '2026-10-31', '2026-11-15'), HOY)).toMatch(/2 semanas antes/);
    expect((await errores(licencia('licencia_maternidad', '2026-11-16', '2026-11-15'))).fechaNacimiento).toMatch(/maternidad/);
    await registrar(licencia('licencia_maternidad', '2026-11-15', '2026-11-15'));
    expect(baseDeDatos.incapacidades[0].fechaNacimiento).toBe('2026-11-15');
  });

  it('las demás incapacidades no guardan una fecha de nacimiento aunque llegue en el formulario', async () => {
    await registrar({ fechaNacimiento: '2026-11-01' });
    expect(baseDeDatos.incapacidades[0].fechaNacimiento).toBeNull();
  });

  it('el plazo de «30 días desde el nacimiento» se cuenta desde la fecha registrada (radicación y alertas)', async () => {
    await registrar({ ...licencia('licencia_paternidad', '2026-11-05', '2026-10-25'), fechaRecepcion: '2026-11-06' });
    const { plazo } = await control.prepararRadicacion(1);
    expect(plazo).toMatchObject({ regla: 'paternidad', base: 'nacimiento', desde: '2026-10-25', fechaLimite: '2026-11-24' });
    const { porVencer } = await control.obtenerAlertas({ tipo: 'paternidad' });
    expect(porVencer).toEqual([expect.objectContaining({ tipo: 'paternidad', fechaLimite: '2026-11-24', base: 'nacimiento' })]);
  });
});
