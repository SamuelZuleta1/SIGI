// HU-08 — registrar el segundo llamado (DS-03, CU-05 A1): Control con persistencia y correo falsos.
// Decisiones: DA-07 (manual), DA-32 (solo con el plazo vencido), DA-33 (uno por aviso), DA-34 (solo se confirma).
import { beforeEach, describe, expect, it } from 'vitest';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { ErrorDeValidacion } from '../../src/controllers/error-de-validacion.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso, DESTINATARIOS } from '../helpers/correo-falso.js';
import { documentoDePrueba, formularioDeRegistro } from '../helpers/fabricas.js';
import { USUARIOS } from '../helpers/sesion-falsa.js';

let baseDeDatos;
let control;
let enviados;
let hoy;

// Incapacidad 1: accidente de tránsito con el soporte. Aviso del martes 17 de noviembre por la epicrisis y el
// FURIPS: el plazo vence el viernes 20 y el segundo llamado se puede registrar desde el lunes 23.
beforeEach(async () => {
  baseDeDatos = crearBaseDeDatosFalsa();
  const correoFalso = crearCorreoFalso();
  enviados = correoFalso.enviados;
  hoy = '2026-11-17';
  control = crearControlIncapacidades({ baseDeDatos, correo: correoFalso.correo, hoy: () => hoy });
  await control.registrarIncapacidad(formularioDeRegistro({ tipo: 'accidente_transito' }), USUARIOS.receptor);
  await control.registrarDocumentos(1, [documentoDePrueba()], USUARIOS.receptor);
  await control.notificarFaltantes(1, ['epicrisis', 'furips']);
  enviados.length = 0; // sin el aviso de recepción ni el de faltantes
});

const fallo = (promesa) => promesa.then(() => null, (e) => e);

describe('HU-08.CA1 — registrar el segundo llamado y avisar a la Coordinación', () => {
  it('HU-08.CA1 — pasados los 3 días hábiles guarda el segundo llamado', async () => {
    hoy = '2026-11-23';
    expect(await control.registrarSegundoLlamado('1')).toEqual({ idIncapacidad: 1 });
    expect(baseDeDatos.incapacidades[0]).toMatchObject({
      segundoLlamado: true,
      documentacionCompleta: false, // la documentación sigue incompleta
      fechaAvisoFaltantes: '2026-11-17',
    });
  });

  it('HU-08.CA1 — avisa por correo a la Coordinación la citación, con los documentos pendientes y el plazo', async () => {
    hoy = '2026-11-23';
    await control.registrarSegundoLlamado(1);
    expect(enviados).toHaveLength(1);
    const [correo] = enviados;
    expect(correo.to).toBe(DESTINATARIOS.coordinacion);
    expect(correo.subject).toBe('[SIGI] Citación por documentos pendientes — incapacidad n.º 1');
    expect(correo.text).toContain('Se solicita citar al colaborador.');
    expect(correo.text).toContain('Aviso de faltantes: martes 17 de noviembre de 2026 · plazo vencido el viernes 20 de noviembre de 2026.');
    expect(correo.text).toContain('Colaborador: Ana María Gómez');
    expect(correo.text).toContain('Correo del colaborador: ana.gomez@sigi.test');
    expect(correo.text).toContain('- Epicrisis o documento soporte');
    expect(correo.text).toContain('- FURIPS');
    expect(correo.attachments).toBeUndefined(); // CAR-11
  });

  it('HU-08.CA1 — la verificación muestra el segundo llamado registrado', async () => {
    hoy = '2026-11-23';
    await control.registrarSegundoLlamado(1);
    const { aviso } = await control.verificarDocumentacion(1);
    expect(aviso).toMatchObject({ pendiente: true, vencido: true, segundoLlamado: true });
  });

  it('si el correo no sale, no se registra el segundo llamado y se puede reintentar', async () => {
    hoy = '2026-11-23';
    const roto = { notificarCitacion: async () => { throw new Error('SMTP caído'); } };
    const conCorreoRoto = crearControlIncapacidades({ baseDeDatos, correo: roto, hoy: () => hoy });
    const error = await fallo(conCorreoRoto.registrarSegundoLlamado(1));
    expect(error).toBeInstanceOf(ErrorDeValidacion);
    expect(error.errores.correo).toMatch(/No se pudo enviar el correo a la Coordinación/);
    expect(baseDeDatos.incapacidades[0].segundoLlamado).toBe(false);
    await control.registrarSegundoLlamado(1);
    expect(baseDeDatos.incapacidades[0].segundoLlamado).toBe(true);
  });

  it('una incapacidad que no existe no se registra', async () => {
    const error = await fallo(control.registrarSegundoLlamado('99'));
    expect(error.errores.incapacidad).toBe('No hay una incapacidad con ese número.');
  });
});

describe('DA-32 — solo con el plazo de 3 días hábiles vencido', () => {
  it.each(['2026-11-17', '2026-11-19', '2026-11-20'])('DA-32 — el %s (plazo corriendo o día límite) no se registra', async (dia) => {
    hoy = dia;
    const error = await fallo(control.registrarSegundoLlamado(1));
    expect(error.errores.llamado).toBe(
      'El colaborador tiene plazo hasta el viernes 20 de noviembre de 2026. Podrá registrar el segundo llamado desde el lunes 23 de noviembre de 2026.',
    );
    expect(enviados).toHaveLength(0);
    expect(baseDeDatos.incapacidades[0].segundoLlamado).toBe(false);
  });

  it('DA-32 — el día siguiente al límite el plazo ya está vencido, aunque sea sábado', async () => {
    hoy = '2026-11-21';
    const { aviso } = await control.verificarDocumentacion(1);
    expect(aviso).toMatchObject({ vencido: true, fechaSegundoLlamado: '2026-11-23' });
    await control.registrarSegundoLlamado(1);
    expect(baseDeDatos.incapacidades[0].segundoLlamado).toBe(true);
  });

  it('sin aviso de faltantes no hay segundo llamado', async () => {
    await control.registrarIncapacidad(formularioDeRegistro({ correoColaborador: 'otro@sigi.test' }), USUARIOS.receptor);
    hoy = '2026-11-30';
    const error = await fallo(control.registrarSegundoLlamado(2));
    expect(error.errores.llamado).toMatch(/No hay un aviso de faltantes pendiente/);
    expect(enviados).toHaveLength(0);
  });

  it('si el colaborador ya entregó documentos (HU-07.CA2), el aviso deja de estar pendiente y no hay segundo llamado', async () => {
    await control.registrarDocumentos(1, [documentoDePrueba({ tipo: 'epicrisis' })], USUARIOS.receptor);
    enviados.length = 0;
    hoy = '2026-11-23';
    const error = await fallo(control.registrarSegundoLlamado(1));
    expect(error.errores.llamado).toMatch(/No hay un aviso de faltantes pendiente/);
    expect(enviados).toHaveLength(0);
  });
});

describe('DA-33 — un segundo llamado por aviso', () => {
  it('DA-33 — no se registra dos veces para el mismo aviso ni se vuelve a avisar a la Coordinación', async () => {
    hoy = '2026-11-23';
    await control.registrarSegundoLlamado(1);
    const error = await fallo(control.registrarSegundoLlamado(1));
    expect(error.errores.llamado).toMatch(/ya se registró/);
    expect(enviados).toHaveLength(1);
  });

  it('DA-33 — un aviso nuevo (llegan documentos y siguen faltando) tiene su propio segundo llamado', async () => {
    hoy = '2026-11-23';
    await control.registrarSegundoLlamado(1);
    await control.registrarDocumentos(1, [documentoDePrueba({ tipo: 'epicrisis' })], USUARIOS.receptor);
    hoy = '2026-11-24';
    await control.notificarFaltantes(1, ['furips']);
    expect(baseDeDatos.incapacidades[0]).toMatchObject({ segundoLlamado: false, fechaAvisoFaltantes: '2026-11-24' });
    enviados.length = 0;

    const temprano = await fallo(control.registrarSegundoLlamado(1));
    expect(temprano.errores.llamado).toMatch(/Podrá registrar el segundo llamado desde el lunes 30 de noviembre de 2026/);
    hoy = '2026-11-30';
    await control.registrarSegundoLlamado(1);
    expect(baseDeDatos.incapacidades[0].segundoLlamado).toBe(true);
    expect(enviados.at(-1).text).toContain('- FURIPS');
    expect(enviados.at(-1).text).not.toContain('Epicrisis');
  });

  it('DA-33 — guardarSegundoLlamado no marca un aviso distinto del que se vio (condición sobre la fecha del aviso)', async () => {
    expect(await baseDeDatos.guardarSegundoLlamado(1, '2026-11-10')).toBe(false);
    expect(await baseDeDatos.guardarSegundoLlamado(1, '2026-11-17')).toBe(true);
    expect(await baseDeDatos.guardarSegundoLlamado(1, '2026-11-17')).toBe(false);
  });
});
