// HU-29 — archivar una incapacidad pagada (DS-13: consultarPagadas, archivarIncapacidad), con persistencia y correo falsos.
// Decisiones: DA-11 (pago identificado y conciliado), DA-12 (solo la epicrisis; correo sin adjuntos), DA-59.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { ErrorDeAviso } from '../../src/controllers/error-de-aviso.js';
import { ErrorDeValidacion } from '../../src/controllers/error-de-validacion.js';
import { ErrorAlEliminarEpicrisis, MENSAJE_SIN_CONCILIAR, pagoConciliado } from '../../src/controllers/archivo.controller.js';
import { MENSAJE_EPICRISIS_ARCHIVADA } from '../../src/controllers/registro.controller.js';
import { MENSAJE_PAGO_ARCHIVADA } from '../../src/controllers/cobro.controller.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { DESTINATARIOS, crearCorreoFalso } from '../helpers/correo-falso.js';
import { PDF, pagoRegistrado } from '../helpers/fabricas.js';
import { USUARIOS } from '../helpers/sesion-falsa.js';

let baseDeDatos;
let control;
let enviados;
let correo;

const errores = async (promesa) => {
  const error = await promesa.catch((e) => e);
  expect(error).toBeInstanceOf(ErrorDeValidacion);
  return error.errores;
};

// Una pagada con su pago; `conciliado` lo marca como si HU-26 lo hubiera identificado. Devuelve el id de la incapacidad.
async function pagada({ colaborador = 'Ana María Gómez', valor = '420000.00', conciliado = true, documentos = [] } = {}) {
  const idPago = await pagoRegistrado(baseDeDatos, { colaborador, valor });
  const pago = baseDeDatos.pagos.find((p) => p.idPago === idPago);
  if (conciliado) Object.assign(pago, { conciliado: true, conciliacionId: 1 });
  if (documentos.length) await baseDeDatos.guardarDocumentos(pago.idIncapacidad, documentos.map((tipo) => ({ tipo, contenido: PDF, tipoMime: 'application/pdf' })), 'id-auxiliar');
  return pago.idIncapacidad;
}

beforeEach(() => {
  baseDeDatos = crearBaseDeDatosFalsa();
  ({ correo, enviados } = crearCorreoFalso());
  control = crearControlIncapacidades({ baseDeDatos, correo });
});

describe('obtenerEstadoPago — identificado y conciliado (DA-11)', () => {
  it('exige al menos un pago y todos conciliados', () => {
    expect(pagoConciliado({ pagos: [] })).toBe(false);
    expect(pagoConciliado({ pagos: [{ conciliado: true }, { conciliado: false }] })).toBe(false);
    expect(pagoConciliado({ pagos: [{ conciliado: true }, { conciliado: true }] })).toBe(true);
  });
});

describe('HU-29.CA1 — lista de pagadas', () => {
  it('muestra las pagadas sin enviar, separadas por situación, con su total pagado', async () => {
    const a = await pagada({ colaborador: 'Ana Gómez' });
    const b = await pagada({ colaborador: 'Luis Pérez', conciliado: false });
    const c = await pagada({ colaborador: 'Marta Ríos' });
    await control.archivarIncapacidad(String(c), USUARIOS.auxiliar);
    // Una cobrada (sin pago) y una ya enviada no aparecen.
    await pagoRegistrado(baseDeDatos, { colaborador: 'Otro', valor: '1.00' });
    baseDeDatos.incapacidades.at(-1).estado = 'cobrada';
    const enviada = await pagada({ colaborador: 'Ya enviada' });
    baseDeDatos.incapacidades.find((i) => i.idIncapacidad === enviada).enviadaAGestionDocumental = true;

    const lista = await control.consultarPagadas();
    expect(lista.ver).toBe('por_archivar');
    expect(lista.pagadas.map((p) => p.idIncapacidad)).toEqual([a]);
    expect(lista.pagadas[0].totalPagado).toBe('420000.00');
    expect(lista.conteos).toEqual({ por_archivar: 1, sin_conciliar: 1, preparado: 1 });
    expect((await control.consultarPagadas('sin_conciliar')).pagadas.map((p) => [p.idIncapacidad, p.pagosSinConciliar])).toEqual([[b, 1]]);
    expect((await control.consultarPagadas('preparado')).pagadas.map((p) => p.idIncapacidad)).toEqual([c]);
    expect((await control.consultarPagadas('otra')).ver).toBe('por_archivar');
  });

  it('una pagada con un segundo pago sin conciliar vuelve a «pago sin conciliar»', async () => {
    const id = await pagada();
    await baseDeDatos.guardarPago(id, { valor: '1000.00', fechaPago: '2026-11-12' }, 'id-auxiliar');
    expect((await control.consultarPagadas('sin_conciliar')).pagadas.map((p) => p.idIncapacidad)).toEqual([id]);
  });

  it('la pantalla de archivo solo existe para pagadas', async () => {
    const id = await pagada();
    expect((await control.prepararArchivo(String(id))).situacion).toBe('por_archivar');
    baseDeDatos.incapacidades[0].estado = 'cobrada';
    expect(await control.prepararArchivo(String(id))).toBeNull();
    expect(await control.prepararArchivo('99')).toBeNull();
    expect(await control.prepararArchivo('abc')).toBeNull();
  });
});

describe('HU-29.CA2 — archivar con el pago conciliado', () => {
  it('elimina solo la epicrisis, avisa a Gestión Documental sin adjuntos y deja el archivo preparado', async () => {
    const id = await pagada({ documentos: ['soporte_incapacidad', 'epicrisis', 'historia_clinica'] });
    const resultado = await control.archivarIncapacidad(String(id), USUARIOS.auxiliar);

    expect(resultado).toEqual({ idIncapacidad: id, epicrisisEliminadas: 1 });
    expect(baseDeDatos.documentos.map((d) => d.tipo)).toEqual(['soporte_incapacidad', 'historia_clinica']);
    const incapacidad = baseDeDatos.incapacidades.find((i) => i.idIncapacidad === id);
    expect(incapacidad.fechaArchivoPreparado).toEqual(expect.any(String));
    expect(incapacidad.archivoPreparadoPor).toBe(USUARIOS.auxiliar.id);
    expect(incapacidad.enviadaAGestionDocumental).toBeFalsy(); // eso es HU-30

    expect(enviados).toHaveLength(1);
    const [mensaje] = enviados;
    expect(mensaje.to).toBe(DESTINATARIOS.gestionDocumental);
    expect(mensaje.attachments).toBeUndefined();
    expect(mensaje.text).toContain(`Incapacidad n.º ${id}`);
    expect(mensaje.text).toContain('Ana María Gómez');
    expect(mensaje.text).toMatch(/Total pagado por la entidad: \$\s420\.000/);
    expect(mensaje.text).toContain('- Soporte de la incapacidad');
    expect(mensaje.text).toContain('- Historia clínica');
    expect(mensaje.text).not.toContain('- Epicrisis');
    expect(mensaje.text).toContain('La epicrisis se eliminó de SIGI');
  });

  it('sin epicrisis archiva igual y el correo lo dice', async () => {
    const id = await pagada({ documentos: ['soporte_incapacidad'] });
    expect(await control.archivarIncapacidad(String(id), USUARIOS.auxiliar)).toEqual({ idIncapacidad: id, epicrisisEliminadas: 0 });
    expect(enviados[0].text).toContain('no tenía epicrisis');
  });

  it('no se archiva dos veces ni sale un segundo correo', async () => {
    const id = await pagada();
    await control.archivarIncapacidad(String(id), USUARIOS.auxiliar);
    expect((await errores(control.archivarIncapacidad(String(id), USUARIOS.auxiliar))).estado).toMatch(/ya está preparado/);
    expect(enviados).toHaveLength(1);
  });

  it('si otro usuario lo preparó a la vez, no guarda ni envía nada', async () => {
    const id = await pagada({ documentos: ['epicrisis'] });
    const original = baseDeDatos.guardarArchivoPreparado;
    baseDeDatos.guardarArchivoPreparado = async (...args) => {
      await original(...args); // se adelantó otro
      return original(...args);
    };
    expect((await errores(control.archivarIncapacidad(String(id), USUARIOS.auxiliar))).estado).toMatch(/ya está preparado/);
    expect(enviados).toHaveLength(0);
    expect(baseDeDatos.documentos).toHaveLength(1);
  });

  it('si el correo falla quita la marca (502) y se puede reintentar; la epicrisis ya eliminada no vuelve', async () => {
    const id = await pagada({ documentos: ['epicrisis'] });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const enviarParaArchivo = vi.spyOn(correo, 'enviarParaArchivo').mockRejectedValueOnce(new Error('SMTP caído'));
    const error = await control.archivarIncapacidad(String(id), USUARIOS.auxiliar).catch((e) => e);
    expect(error).toBeInstanceOf(ErrorDeAviso);
    expect(error.deshecho).toBe(true);
    expect(baseDeDatos.incapacidades.find((i) => i.idIncapacidad === id).fechaArchivoPreparado).toBeNull();
    expect(baseDeDatos.documentos).toHaveLength(0);

    expect(await control.archivarIncapacidad(String(id), USUARIOS.auxiliar)).toEqual({ idIncapacidad: id, epicrisisEliminadas: 0 });
    expect(enviarParaArchivo).toHaveBeenCalledTimes(2);
  });

  it('si no se puede eliminar la epicrisis, quita la marca, no envía el correo y lo dice con su propio error', async () => {
    const id = await pagada({ documentos: ['epicrisis'] });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    baseDeDatos.eliminarEpicrisis = async () => {
      throw new Error('Storage caído');
    };
    const error = await control.archivarIncapacidad(String(id), USUARIOS.auxiliar).catch((e) => e);
    expect(error).toBeInstanceOf(ErrorAlEliminarEpicrisis);
    expect(error).toMatchObject({ idIncapacidad: id, deshecho: true });
    expect(error.cause.message).toBe('Storage caído');
    expect(baseDeDatos.incapacidades.find((i) => i.idIncapacidad === id).fechaArchivoPreparado).toBeNull();
    expect(enviados).toHaveLength(0);
  });

  it('si además no se puede quitar la marca, el error lo dice (deshecho: false)', async () => {
    const id = await pagada();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    baseDeDatos.eliminarEpicrisis = async () => {
      throw new Error('Storage caído');
    };
    baseDeDatos.deshacerArchivoPreparado = async () => {
      throw new Error('BD caída');
    };
    expect(await control.archivarIncapacidad(String(id), USUARIOS.auxiliar).catch((e) => e)).toMatchObject({ deshecho: false });
  });

  it('con el archivo preparado no se registra una epicrisis nueva; los demás documentos sí (CAR-11)', async () => {
    const id = await pagada();
    await control.archivarIncapacidad(String(id), USUARIOS.auxiliar);
    const documento = (tipo) => ({ tipo, contenido: PDF });
    expect((await errores(control.registrarDocumentos(String(id), [documento('soporte_incapacidad'), documento('epicrisis')], USUARIOS.auxiliar))).documento1).toBe(
      MENSAJE_EPICRISIS_ARCHIVADA,
    );
    expect(baseDeDatos.documentos).toHaveLength(0);
    expect((await control.registrarDocumentos(String(id), [documento('historia_clinica')], USUARIOS.auxiliar)).cantidad).toBe(1);
  });

  it('deshacer una conciliación quita la marca de archivo preparado de sus incapacidades (DA-59)', async () => {
    const id = await pagada();
    await control.archivarIncapacidad(String(id), USUARIOS.auxiliar);
    await baseDeDatos.deshacerConciliacion(1);
    expect((await control.prepararArchivo(String(id))).situacion).toBe('sin_conciliar');
  });

  it('con el archivo preparado ya no se registran pagos (DA-59)', async () => {
    const id = await pagada();
    await control.archivarIncapacidad(String(id), USUARIOS.auxiliar);
    expect((await control.prepararCobro(String(id))).puedeRegistrarPago).toBe(false);
    expect((await errores(control.registrarPago(String(id), { valor: '1000', fechaPago: '2026-11-12' }, USUARIOS.auxiliar))).estado).toBe(
      MENSAJE_PAGO_ARCHIVADA,
    );
    expect(await baseDeDatos.guardarPago(id, { valor: '1000.00', fechaPago: '2026-11-12' }, 'id-auxiliar')).toBeNull();
  });
});

describe('HU-29.CA3 — pago no identificado', () => {
  it('advierte y no envía nada ni elimina la epicrisis', async () => {
    const id = await pagada({ conciliado: false, documentos: ['epicrisis'] });
    expect((await errores(control.archivarIncapacidad(String(id), USUARIOS.auxiliar))).estado).toBe(MENSAJE_SIN_CONCILIAR);
    expect(enviados).toHaveLength(0);
    expect(baseDeDatos.documentos).toHaveLength(1);
    expect(baseDeDatos.incapacidades.find((i) => i.idIncapacidad === id).fechaArchivoPreparado).toBeUndefined();
  });

  it('con un pago conciliado y otro no, tampoco se archiva', async () => {
    const id = await pagada();
    await baseDeDatos.guardarPago(id, { valor: '1000.00', fechaPago: '2026-11-12' }, 'id-auxiliar');
    expect((await errores(control.archivarIncapacidad(String(id), USUARIOS.auxiliar))).estado).toBe(MENSAJE_SIN_CONCILIAR);
  });

  it('una incapacidad que no está pagada no se archiva; una que no existe devuelve null', async () => {
    const id = await pagada();
    baseDeDatos.incapacidades[0].estado = 'cobrada';
    expect((await errores(control.archivarIncapacidad(String(id), USUARIOS.auxiliar))).estado).toMatch(/Solo se archivan las incapacidades pagadas/);
    expect(await control.archivarIncapacidad('99', USUARIOS.auxiliar)).toBeNull();
    expect(await control.archivarIncapacidad('x', USUARIOS.auxiliar)).toBeNull();
  });
});
