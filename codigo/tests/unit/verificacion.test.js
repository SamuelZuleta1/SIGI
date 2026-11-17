// Grupo `verificacion` del Control (DS-03, CU-04): compararConRequisitos, verificarDocumentacion,
// registrarVerificacion y verDocumento, con persistencia y correo falsos.
import { beforeEach, describe, expect, it } from 'vitest';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { ErrorDeValidacion } from '../../src/controllers/error-de-validacion.js';
import { compararConRequisitos, documentosObligatorios } from '../../src/controllers/verificacion.controller.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { documentoDePrueba, formularioDeRegistro, PDF } from '../helpers/fabricas.js';
import { USUARIOS } from '../helpers/sesion-falsa.js';

const tipos = (incapacidad, opciones) => documentosObligatorios(incapacidad, opciones).filter((d) => !d.exento).map((d) => d.tipo);
const con = (...lista) => lista.map((tipo, i) => ({ idDocumento: i + 1, tipo }));

describe('HU-06.CA1 — documentos obligatorios por tipo de caso (F1 §2.8)', () => {
  it('HU-06.CA1 — enfermedad general de más de 2 días: soporte y epicrisis', () => {
    expect(tipos({ tipo: 'enfermedad_general', diasIncapacidad: 3 })).toEqual(['soporte_incapacidad', 'epicrisis']);
  });

  it('HU-06.CA1 — enfermedad general de 2 días o menos: solo el soporte', () => {
    expect(tipos({ tipo: 'enfermedad_general', diasIncapacidad: 2 })).toEqual(['soporte_incapacidad']);
    expect(tipos({ tipo: 'enfermedad_general', diasIncapacidad: 1 })).toEqual(['soporte_incapacidad']);
  });

  it.each(['accidente_laboral', 'enfermedad_laboral'])('HU-06.CA1 — %s: soporte y epicrisis, sin importar los días', (tipo) => {
    expect(tipos({ tipo, diasIncapacidad: 1 })).toEqual(['soporte_incapacidad', 'epicrisis']);
  });

  it('HU-06.CA1 — accidente de tránsito: soporte, epicrisis y FURIPS', () => {
    expect(tipos({ tipo: 'accidente_transito', diasIncapacidad: 1 })).toEqual(['soporte_incapacidad', 'epicrisis', 'furips']);
  });

  it('HU-06.CA1 — licencia de maternidad: certificado, epicrisis, nacido vivo, registro civil y documento de identidad', () => {
    expect(tipos({ tipo: 'licencia_maternidad', diasIncapacidad: 126 })).toEqual([
      'soporte_incapacidad', 'epicrisis', 'certificado_nacido_vivo', 'registro_civil', 'documento_identidad',
    ]);
  });

  it('HU-06.CA1 / DA-27 — licencia de paternidad: sin el soporte de la incapacidad', () => {
    expect(tipos({ tipo: 'licencia_paternidad', diasIncapacidad: 14 })).toEqual([
      'epicrisis', 'certificado_nacido_vivo', 'registro_civil', 'documento_identidad',
    ]);
  });

  it.each([
    ['enfermedad_general', 5],
    ['accidente_laboral', 1],
    ['enfermedad_laboral', 10],
  ])('HU-06.CA1 / DA-26 — %s: si la EPS ya transcribió, la epicrisis no se exige', (tipo, diasIncapacidad) => {
    const resultado = compararConRequisitos({ tipo, diasIncapacidad }, con('soporte_incapacidad'), { epsTranscribio: true });
    expect(resultado.requisitos).toEqual([
      { tipo: 'soporte_incapacidad', estado: 'recibido', documentos: [1] },
      { tipo: 'epicrisis', estado: 'exento', documentos: [] },
    ]);
    expect(resultado).toMatchObject({ completa: true, faltantes: [], exigidos: 1, recibidos: 1, epsTranscribio: true });
  });

  it.each([
    ['accidente_transito', 3],
    ['licencia_maternidad', 126],
    ['enfermedad_general', 2],
  ])('DA-26 — en %s la casilla de la EPS no cambia nada', (tipo, diasIncapacidad) => {
    const sin = compararConRequisitos({ tipo, diasIncapacidad }, con('soporte_incapacidad'));
    const conEps = compararConRequisitos({ tipo, diasIncapacidad }, con('soporte_incapacidad'), { epsTranscribio: true });
    expect(conEps).toEqual(sin);
    expect(conEps.epsTranscribio).toBe(false);
  });

  it('HU-06.CA1 — compara con el expediente: recibidos, faltantes y documentos no obligatorios', () => {
    const resultado = compararConRequisitos(
      { tipo: 'accidente_transito', diasIncapacidad: 4 },
      con('soporte_incapacidad', 'historia_clinica', 'soporte_incapacidad'),
    );
    expect(resultado.requisitos).toEqual([
      { tipo: 'soporte_incapacidad', estado: 'recibido', documentos: [1, 3] },
      { tipo: 'epicrisis', estado: 'falta', documentos: [] },
      { tipo: 'furips', estado: 'falta', documentos: [] },
    ]);
    expect(resultado.otros).toEqual([{ tipo: 'historia_clinica', documentos: [2] }]);
    expect(resultado).toMatchObject({ completa: false, faltantes: ['epicrisis', 'furips'], exigidos: 3, recibidos: 1 });
  });
});

describe('HU-06 — verificar la documentación (Control)', () => {
  let baseDeDatos;
  let control;

  beforeEach(() => {
    baseDeDatos = crearBaseDeDatosFalsa();
    control = crearControlIncapacidades({ baseDeDatos, correo: crearCorreoFalso().correo });
  });

  const registrar = async (cambios, documentos, usuario = USUARIOS.receptor) => {
    const { idIncapacidad } = await control.registrarIncapacidad(formularioDeRegistro(cambios), USUARIOS.receptor);
    if (documentos.length) await control.registrarDocumentos(idIncapacidad, documentos.map((tipo) => documentoDePrueba({ tipo })), usuario);
    return idIncapacidad;
  };

  it('HU-06.CA1 — obtiene el expediente, lo compara y devuelve el resultado sin guardar nada', async () => {
    const id = await registrar({ tipo: 'enfermedad_general', diasIncapacidad: '5' }, ['soporte_incapacidad']);
    const { incapacidad, resultado } = await control.verificarDocumentacion(String(id));
    expect(incapacidad).toMatchObject({ idIncapacidad: id, colaborador: 'Ana María Gómez', tipo: 'enfermedad_general', admiteExencion: true });
    expect(resultado.faltantes).toEqual(['epicrisis']);
    expect(baseDeDatos.incapacidades[0]).not.toHaveProperty('archivadoDigital');
  });

  it('HU-06.CA1 — un número que no corresponde a ninguna incapacidad devuelve null', async () => {
    expect(await control.verificarDocumentacion('999')).toBeNull();
    expect(await control.verificarDocumentacion('abc')).toBeNull();
    expect(await control.verificarDocumentacion('0')).toBeNull();
  });

  it('HU-06.CA2 — completa: registra la verificación y archiva en digital', async () => {
    const id = await registrar({ tipo: 'enfermedad_general', diasIncapacidad: '5' }, ['soporte_incapacidad', 'epicrisis']);
    expect(await control.registrarVerificacion(String(id))).toEqual({ idIncapacidad: id });
    expect(baseDeDatos.incapacidades[0]).toMatchObject({ documentacionCompleta: true, archivadoDigital: true });
  });

  it('HU-06.CA2 / DA-26 — con la EPS que ya transcribió, se archiva sin epicrisis', async () => {
    const id = await registrar({ tipo: 'enfermedad_laboral', diasIncapacidad: '8' }, ['soporte_incapacidad']);
    await control.registrarVerificacion(id, { epsTranscribio: true });
    expect(baseDeDatos.incapacidades[0].archivadoDigital).toBe(true);
  });

  it('HU-06.CA3 — faltan documentos: no registra ni archiva', async () => {
    const id = await registrar({ tipo: 'accidente_transito', diasIncapacidad: '3' }, ['soporte_incapacidad', 'epicrisis']);
    const error = await control.registrarVerificacion(id).catch((e) => e);
    expect(error).toBeInstanceOf(ErrorDeValidacion);
    expect(error.errores.documentos).toMatch(/Faltan documentos/);
    expect(baseDeDatos.incapacidades[0]).not.toHaveProperty('archivadoDigital');
  });

  it('HU-06.CA3 — sin ningún documento registrado, todo falta', async () => {
    const id = await registrar({ tipo: 'licencia_paternidad', diasIncapacidad: '14' }, []);
    const { resultado } = await control.verificarDocumentacion(id);
    expect(resultado).toMatchObject({ completa: false, exigidos: 4, recibidos: 0 });
    await expect(control.registrarVerificacion(id)).rejects.toBeInstanceOf(ErrorDeValidacion);
  });

  it('registrarVerificacion con un número inexistente → error de validación', async () => {
    const error = await control.registrarVerificacion('77').catch((e) => e);
    expect(error.errores).toEqual({ incapacidad: 'No hay una incapacidad con ese número.' });
  });

  it('DA-28 — el original en físico pendiente se informa pero no impide archivar', async () => {
    const id = await registrar({ tipo: 'enfermedad_general', diasIncapacidad: '1' }, ['soporte_incapacidad'], USUARIOS.auxiliar);
    const { incapacidad, resultado } = await control.verificarDocumentacion(id);
    expect(incapacidad.originalPendiente).toBe(true);
    expect(resultado.completa).toBe(true);
    await control.registrarVerificacion(id);
    expect(baseDeDatos.incapacidades[0].archivadoDigital).toBe(true);
  });

  it('DA-06 — ver documento: el servidor entrega el archivo con su tipo y un nombre sin datos personales', async () => {
    await registrar({}, ['epicrisis']);
    const documento = await control.obtenerDocumento('1');
    expect(documento).toMatchObject({ idDocumento: 1, idIncapacidad: 1, tipo: 'epicrisis' });
    const archivo = await control.verDocumento(documento);
    expect(archivo).toEqual({ tipo: 'epicrisis', contenido: PDF, tipoMime: 'application/pdf', nombre: 'epicrisis-1.pdf' });
  });

  it('DA-06 — un documento que no existe devuelve null', async () => {
    expect(await control.obtenerDocumento('5')).toBeNull();
    expect(await control.obtenerDocumento('x')).toBeNull();
  });
});
