// Grupo `registro` del Control (DS-01, CU-02): registrarDocumentos, con persistencia y correo falsos.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { ErrorDeValidacion } from '../../src/controllers/error-de-validacion.js';
import { MAXIMO_DOCUMENTOS, TAMANO_MAXIMO_ARCHIVO } from '../../src/controllers/registro.controller.js';
import { TIPOS_DOCUMENTO } from '../../src/models/documento.model.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso, DESTINATARIOS } from '../helpers/correo-falso.js';
import { documentoDePrueba, formularioDeRegistro, JPG, PNG } from '../helpers/fabricas.js';
import { USUARIOS } from '../helpers/sesion-falsa.js';

let baseDeDatos;
let control;
let enviados;
let id;

beforeEach(async () => {
  baseDeDatos = crearBaseDeDatosFalsa();
  const falso = crearCorreoFalso();
  enviados = falso.enviados;
  control = crearControlIncapacidades({ baseDeDatos, correo: falso.correo });
  ({ idIncapacidad: id } = await control.registrarIncapacidad(formularioDeRegistro(), USUARIOS.receptor));
});

const errorDe = async (idIncapacidad, documentos, usuario = USUARIOS.receptor) => {
  const error = await control.registrarDocumentos(idIncapacidad, documentos, usuario).catch((e) => e);
  expect(error).toBeInstanceOf(ErrorDeValidacion);
  expect(baseDeDatos.documentos).toHaveLength(0);
  expect(enviados).toHaveLength(0);
  return error.errores;
};

describe('HU-04 — registrar la documentación recibida (Control)', () => {
  it('HU-04.CA1 — el receptor guarda cada documento con su tipo y su archivo, asociado a la incapacidad', async () => {
    const resultado = await control.registrarDocumentos(
      id,
      [documentoDePrueba(), documentoDePrueba({ tipo: 'epicrisis', contenido: PNG }), documentoDePrueba({ tipo: 'furips', contenido: JPG })],
      USUARIOS.receptor,
    );
    expect(resultado).toEqual({ idIncapacidad: id, cantidad: 3, originalPendiente: false, avisoEnviado: true });
    expect(baseDeDatos.documentos).toMatchObject([
      { idIncapacidad: id, tipo: 'soporte_incapacidad', tipoMime: 'application/pdf', creadoPor: USUARIOS.receptor.id },
      { idIncapacidad: id, tipo: 'epicrisis', tipoMime: 'image/png' },
      { idIncapacidad: id, tipo: 'furips', tipoMime: 'image/jpeg' },
    ]);
    expect(baseDeDatos.documentos.every((d) => d.archivo.startsWith(`incapacidades/${id}/`))).toBe(true);
  });

  it('HU-04.CA1 — avisa al auxiliar por correo (notificarRecepcion), sin adjuntos ni datos clínicos', async () => {
    await control.registrarDocumentos(id, [documentoDePrueba({ tipo: 'epicrisis' })], USUARIOS.receptor);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].to).toBe(DESTINATARIOS.auxiliar);
    expect(enviados[0].subject).toContain(`incapacidad n.º ${id}`);
    expect(enviados[0].text).toContain('Ana María Gómez');
    expect(enviados[0].text).toContain('Nueva EPS');
    expect(enviados[0]).not.toHaveProperty('attachments');
    expect(enviados[0].text).not.toMatch(/epicrisis/i);
    expect(baseDeDatos.incapacidades[0].originalPendiente ?? false).toBe(false);
  });

  it('HU-04.CA2 — por correo (auxiliar): guarda, marca el original como pendiente y no envía aviso', async () => {
    const resultado = await control.registrarDocumentos(id, [documentoDePrueba()], USUARIOS.auxiliar);
    expect(resultado).toEqual({ idIncapacidad: id, cantidad: 1, originalPendiente: true, avisoEnviado: false });
    expect(baseDeDatos.documentos).toHaveLength(1);
    expect(baseDeDatos.incapacidades[0].originalPendiente).toBe(true);
    expect(enviados).toHaveLength(0);
  });

  it('HU-04.CA1 — si el correo falla, los documentos quedan guardados y se informa que no hubo aviso', async () => {
    const silencio = vi.spyOn(console, 'error').mockImplementation(() => {});
    control = crearControlIncapacidades({
      baseDeDatos,
      correo: { notificarRecepcion: async () => { throw new Error('SMTP caído'); } },
    });
    const resultado = await control.registrarDocumentos(id, [documentoDePrueba()], USUARIOS.receptor);
    expect(resultado.avisoEnviado).toBe(false);
    expect(baseDeDatos.documentos).toHaveLength(1);
    silencio.mockRestore();
  });

  it.each(TIPOS_DOCUMENTO)('DA-06 — acepta el tipo de documento %s', async (tipo) => {
    await control.registrarDocumentos(id, [documentoDePrueba({ tipo })], USUARIOS.auxiliar);
    expect(baseDeDatos.documentos[0].tipo).toBe(tipo);
  });

  it('DA-06 — son exactamente 7 tipos y cualquier otro se rechaza', async () => {
    expect(TIPOS_DOCUMENTO).toHaveLength(7);
    expect(await errorDe(id, [documentoDePrueba({ tipo: 'cedula' })])).toEqual({ documento0: 'Elija el tipo de documento.' });
  });

  it.each([['999'], ['abc'], [''], [undefined], ['1; drop table']])(
    'HU-04.CA1 — la incapacidad debe estar registrada (número %s)',
    async (numero) => {
      expect(await errorDe(numero, [documentoDePrueba()])).toHaveProperty('incapacidad');
    },
  );

  it('HU-04.CA1 — sin documentos no registra nada', async () => {
    expect(await errorDe(id, [])).toHaveProperty('documentos');
    expect(await errorDe(id, undefined)).toHaveProperty('documentos');
  });

  it('no acepta más documentos de los permitidos en un envío', async () => {
    const muchos = Array.from({ length: MAXIMO_DOCUMENTOS + 1 }, () => documentoDePrueba());
    expect(await errorDe(id, muchos)).toHaveProperty('documentos');
  });

  it.each([
    ['vacío', Buffer.alloc(0), 'Adjunte el archivo.'],
    ['que no es PDF, JPG ni PNG', Buffer.from('MZ ejecutable'), 'El archivo debe ser PDF, JPG o PNG.'],
    ['de más de 10 MB', Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(TAMANO_MAXIMO_ARCHIVO)]), 'El archivo pesa más de 10 MB.'],
    ['ausente', undefined, 'Adjunte el archivo.'],
  ])('rechaza un archivo %s y no guarda ninguno del envío', async (_caso, contenido, mensaje) => {
    const errores = await errorDe(id, [documentoDePrueba(), documentoDePrueba({ tipo: 'epicrisis', contenido })]);
    expect(errores).toEqual({ documento1: mensaje });
  });

  it('DA-23 — guarda el usuario que registró los documentos', async () => {
    await control.registrarDocumentos(id, [documentoDePrueba()], USUARIOS.auxiliar);
    expect(baseDeDatos.documentos[0].creadoPor).toBe(USUARIOS.auxiliar.id);
  });

  it('obtenerIncapacidad devuelve los datos que la identifican, o null si no existe', async () => {
    expect(await control.obtenerIncapacidad(String(id))).toMatchObject({
      idIncapacidad: id, colaborador: 'Ana María Gómez', entidad: 'Nueva EPS', tipo: 'enfermedad_general',
    });
    expect(await control.obtenerIncapacidad('77')).toBeNull();
    expect(await control.obtenerIncapacidad('x')).toBeNull();
  });
});
