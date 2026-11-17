// HU-07 — notificar los documentos faltantes (DS-03, CU-05): Control con persistencia y correo falsos.
// Decisiones: DA-29 (registrar documentos reabre la verificación), DA-30 (lista editable),
// DA-31 (no se repite el aviso hasta que lleguen documentos), DA-13 (3 días hábiles).
import { beforeEach, describe, expect, it } from 'vitest';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { ErrorDeValidacion } from '../../src/controllers/error-de-validacion.js';
import { validarFaltantes } from '../../src/controllers/verificacion.controller.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { documentoDePrueba, formularioDeRegistro } from '../helpers/fabricas.js';
import { USUARIOS } from '../helpers/sesion-falsa.js';

let baseDeDatos;
let control;
let enviados;
let hoy;

// Incapacidad 1: accidente de tránsito con el soporte; faltan la epicrisis y el FURIPS.
beforeEach(async () => {
  baseDeDatos = crearBaseDeDatosFalsa();
  const correoFalso = crearCorreoFalso();
  enviados = correoFalso.enviados;
  hoy = '2026-11-17';
  control = crearControlIncapacidades({ baseDeDatos, correo: correoFalso.correo, hoy: () => hoy });
  await control.registrarIncapacidad(formularioDeRegistro({ tipo: 'accidente_transito' }), USUARIOS.receptor);
  await control.registrarDocumentos(1, [documentoDePrueba()], USUARIOS.receptor);
  enviados.length = 0; // sin el aviso de recepción al auxiliar
});

const fallo = (promesa) => promesa.then(() => null, (e) => e);

describe('HU-07.CA1 — registrar y notificar los faltantes', () => {
  it('HU-07.CA1 — guarda la lista y la fecha del aviso y deja la documentación como incompleta', async () => {
    const resultado = await control.notificarFaltantes('1', ['epicrisis', 'furips']);
    expect(resultado).toEqual({ idIncapacidad: 1, faltantes: ['epicrisis', 'furips'], fechaAviso: '2026-11-17', fechaLimite: '2026-11-20' });
    expect(baseDeDatos.incapacidades[0]).toMatchObject({
      faltantes: ['epicrisis', 'furips'],
      fechaAvisoFaltantes: '2026-11-17',
      documentacionCompleta: false,
      archivadoDigital: false,
    });
  });

  it('HU-07.CA1 — envía al colaborador el correo con los documentos y el plazo de 3 días hábiles', async () => {
    await control.notificarFaltantes(1, ['epicrisis', 'furips']);
    expect(enviados).toHaveLength(1);
    const [correo] = enviados;
    expect(correo.to).toBe('ana.gomez@sigi.test');
    expect(correo.subject).toBe('[SIGI] Documentos faltantes de su incapacidad');
    expect(correo.text).toContain('- Epicrisis o documento soporte');
    expect(correo.text).toContain('- FURIPS');
    expect(correo.text).toContain('Tiene 3 días hábiles para entregarlos (hasta el viernes 20 de noviembre de 2026).');
    expect(correo.attachments).toBeUndefined(); // CAR-11
  });

  it('HU-07.CA1 / DA-13 — el plazo salta el fin de semana y el festivo', async () => {
    hoy = '2026-11-12';
    const { fechaLimite } = await control.notificarFaltantes(1, ['epicrisis']);
    expect(fechaLimite).toBe('2026-11-18');
  });

  it('HU-07.CA1 — el resultado de la verificación muestra el aviso registrado con su plazo', async () => {
    await control.notificarFaltantes(1, ['epicrisis', 'furips']);
    hoy = '2026-11-19';
    const { aviso } = await control.verificarDocumentacion(1);
    expect(aviso).toEqual({
      faltantes: ['epicrisis', 'furips'],
      fechaAviso: '2026-11-17',
      fechaLimite: '2026-11-20',
      diasRestantes: 1,
      pendiente: true,
    });
  });

  it('DA-30 — el auxiliar puede quitar un faltante y añadir otro tipo del catálogo', async () => {
    await control.notificarFaltantes(1, ['historia_clinica', 'furips']);
    expect(baseDeDatos.incapacidades[0].faltantes).toEqual(['historia_clinica', 'furips']); // orden del catálogo
    expect(enviados[0].text).toContain('- Historia clínica');
    expect(enviados[0].text).not.toContain('Epicrisis');
  });

  it('DA-30 — sin documentos marcados o con un tipo desconocido no envía ni guarda', async () => {
    for (const tipos of [[], undefined, ['furips', 'radiografia']]) {
      const error = await fallo(control.notificarFaltantes(1, tipos));
      expect(error).toBeInstanceOf(ErrorDeValidacion);
    }
    expect((await fallo(control.notificarFaltantes(1, []))).errores.faltantes).toBe('Marque al menos un documento.');
    expect(enviados).toHaveLength(0);
    expect(baseDeDatos.incapacidades[0].documentacionCompleta).toBeNull();
  });

  it('validarFaltantes quita repetidos y vacíos', () => {
    expect(validarFaltantes(['furips', 'furips', '', 'epicrisis'])).toEqual(['epicrisis', 'furips']);
    expect(validarFaltantes('furips')).toEqual(['furips']);
  });

  it('con la documentación completa no hay faltantes que notificar', async () => {
    await control.registrarDocumentos(1, [documentoDePrueba({ tipo: 'epicrisis' }), documentoDePrueba({ tipo: 'furips' })], USUARIOS.receptor);
    enviados.length = 0;
    const error = await fallo(control.notificarFaltantes(1, ['epicrisis']));
    expect(error.errores.faltantes).toMatch(/completa/);
    expect(enviados).toHaveLength(0);
  });

  it('una incapacidad ya archivada no se notifica aunque hoy aparezcan faltantes (DA-26 no se guarda)', async () => {
    // Enfermedad laboral archivada con «La EPS ya transcribió»: sin la casilla, la epicrisis aparece como faltante.
    await control.registrarIncapacidad(formularioDeRegistro({ tipo: 'enfermedad_laboral', correoColaborador: 'otro@sigi.test' }), USUARIOS.receptor);
    await control.registrarDocumentos(2, [documentoDePrueba()], USUARIOS.receptor);
    await control.registrarVerificacion(2, { epsTranscribio: true });
    enviados.length = 0;
    const error = await fallo(control.notificarFaltantes(2, ['epicrisis']));
    expect(error.errores.faltantes).toMatch(/ya se verificó y está archivada/);
    expect(enviados).toHaveLength(0);
    expect(baseDeDatos.incapacidades[1]).toMatchObject({ documentacionCompleta: true, archivadoDigital: true });
  });

  it('una incapacidad que no existe no se notifica', async () => {
    const error = await fallo(control.notificarFaltantes('99', ['epicrisis']));
    expect(error.errores.incapacidad).toBe('No hay una incapacidad con ese número.');
  });

  it('si el correo no sale, no se registra el aviso y se puede reintentar', async () => {
    const roto = { notificarFaltantes: async () => { throw new Error('SMTP caído'); } };
    const conCorreoRoto = crearControlIncapacidades({ baseDeDatos, correo: roto, hoy: () => hoy });
    const error = await fallo(conCorreoRoto.notificarFaltantes(1, ['epicrisis']));
    expect(error.errores.correo).toMatch(/No se pudo enviar el correo/);
    expect(baseDeDatos.incapacidades[0]).toMatchObject({ documentacionCompleta: null });
    expect(baseDeDatos.incapacidades[0].fechaAvisoFaltantes).toBeUndefined();
    await control.notificarFaltantes(1, ['epicrisis']);
    expect(baseDeDatos.incapacidades[0].documentacionCompleta).toBe(false);
  });
});

describe('DA-31 — no se repite el aviso hasta que lleguen documentos', () => {
  it('DA-31 — con un aviso pendiente no vuelve a enviar ni cambia la fecha', async () => {
    await control.notificarFaltantes(1, ['epicrisis', 'furips']);
    hoy = '2026-11-18';
    const error = await fallo(control.notificarFaltantes(1, ['furips']));
    expect(error.errores.faltantes).toMatch(/Ya se notificaron los faltantes/);
    expect(enviados).toHaveLength(1);
    expect(baseDeDatos.incapacidades[0]).toMatchObject({ fechaAvisoFaltantes: '2026-11-17', faltantes: ['epicrisis', 'furips'] });
  });
});

describe('HU-07.CA2 — al registrar documentos vuelve a quedar lista para verificarse (DA-29)', () => {
  it('HU-07.CA2 — tras el aviso, registrar documentos la reabre y conserva el último aviso', async () => {
    await control.notificarFaltantes(1, ['epicrisis', 'furips']);
    await control.registrarDocumentos(1, [documentoDePrueba({ tipo: 'epicrisis' })], USUARIOS.receptor);
    expect(baseDeDatos.incapacidades[0]).toMatchObject({
      documentacionCompleta: null,
      faltantes: ['epicrisis', 'furips'],
      fechaAvisoFaltantes: '2026-11-17',
    });
    const { resultado, aviso } = await control.verificarDocumentacion(1);
    expect(resultado.faltantes).toEqual(['furips']);
    expect(aviso.pendiente).toBe(false);
  });

  it('HU-07.CA2 / DA-31 — si siguen faltando, se puede notificar de nuevo con nueva fecha', async () => {
    await control.notificarFaltantes(1, ['epicrisis', 'furips']);
    await control.registrarDocumentos(1, [documentoDePrueba({ tipo: 'epicrisis' })], USUARIOS.receptor);
    hoy = '2026-11-19';
    await control.notificarFaltantes(1, ['furips']);
    expect(baseDeDatos.incapacidades[0]).toMatchObject({ faltantes: ['furips'], fechaAvisoFaltantes: '2026-11-19', documentacionCompleta: false });
  });

  it('HU-07.CA2 — con todo entregado, la verificación se puede confirmar y archivar', async () => {
    await control.notificarFaltantes(1, ['epicrisis', 'furips']);
    await control.registrarDocumentos(1, [documentoDePrueba({ tipo: 'epicrisis' }), documentoDePrueba({ tipo: 'furips' })], USUARIOS.receptor);
    await control.registrarVerificacion(1);
    expect(baseDeDatos.incapacidades[0]).toMatchObject({ documentacionCompleta: true, archivadoDigital: true });
  });

  it('DA-29 — documentos nuevos después de archivar reabren la verificación', async () => {
    await control.registrarDocumentos(1, [documentoDePrueba({ tipo: 'epicrisis' }), documentoDePrueba({ tipo: 'furips' })], USUARIOS.receptor);
    await control.registrarVerificacion(1);
    await control.registrarDocumentos(1, [documentoDePrueba({ tipo: 'historia_clinica' })], USUARIOS.receptor);
    expect(baseDeDatos.incapacidades[0]).toMatchObject({ documentacionCompleta: null, archivadoDigital: false });
  });
});
