// HU-19 — trasladar a Cartera y Jurídica (DS-08: trasladarACartera → guardarTraslado → notificarTraslado), con
// persistencia y correo falsos. DA-44 y la auditoría de las HU (decisión 4A, cambia DA-05 y DA-14): causal de una lista
// cerrada, mínimo 2 requerimientos exigidos, 180 días contados desde fecha_cobrada, deterioro sin demora y rechazo.
import { beforeEach, describe, expect, it } from 'vitest';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { ErrorDeValidacion } from '../../src/controllers/error-de-validacion.js';
import { impedimentoDeCausal, leerMotivo } from '../../src/controllers/cobro-juridico.controller.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso, DESTINATARIOS } from '../helpers/correo-falso.js';
import { formularioDeRegistro, PDF } from '../helpers/fabricas.js';
import { USUARIOS } from '../helpers/sesion-falsa.js';

let baseDeDatos;
let control;
let enviados;
let hoy;

// La 1 queda cobrada el 21 nov 2026 con 10 días (prometida: 1 dic); hoy es el 4 dic (con demora).
beforeEach(async () => {
  hoy = '2026-11-21';
  baseDeDatos = crearBaseDeDatosFalsa();
  const correoFalso = crearCorreoFalso();
  enviados = correoFalso.enviados;
  control = crearControlIncapacidades({ baseDeDatos, correo: correoFalso.correo, hoy: () => hoy });
  await control.registrarIncapacidad(formularioDeRegistro(), USUARIOS.receptor);
  await control.registrarRadicacion('1', { radicado: 'RAD-1', evidencia: PDF }, USUARIOS.auxiliar);
  await control.registrarCobrada('1', { tiempoPago: '10' });
  hoy = '2026-12-04';
});

const requerir = (n = 1, id = '1') => control.registrarRequerimiento(id, { fundamentos: `Requerimiento número ${n} de cobro.` }, USUARIOS.auxiliar);
const trasladar = ({ causal = 'deterioro', motivo = 'La entidad está en liquidación', id = '1' } = {}) => control.trasladarACartera(id, { causal, motivo });
const errores = async (promesa) => {
  const error = await promesa.catch((e) => e);
  expect(error).toBeInstanceOf(ErrorDeValidacion);
  return error.errores;
};
/** Una segunda incapacidad, rechazada por la entidad. */
const rechazada = async () => {
  await control.registrarIncapacidad(formularioDeRegistro({ correoColaborador: 'otro@correo.co' }), USUARIOS.receptor);
  await control.registrarRadicacion('2', { radicado: 'RAD-2', evidencia: PDF }, USUARIOS.auxiliar);
  await control.registrarRechazo('2', { causal: 'Falta la epicrisis del paciente' });
};

describe('HU-19.CA1 — traslado con causal, motivo y correo a Cartera y Jurídica', () => {
  it('HU-19.CA1 — con 2 requerimientos guarda la causal, el motivo y la fecha y avisa a Cartera con ambos', async () => {
    await requerir(1);
    await requerir(2);
    expect(await trasladar()).toEqual({ idIncapacidad: 1, requerimientos: 2, causal: 'deterioro' });
    expect(baseDeDatos.incapacidades[0]).toMatchObject({
      estado: 'cobrada', causalTraslado: 'deterioro', motivoTraslado: 'La entidad está en liquidación', fechaTraslado: '2026-12-04',
    });
    expect(enviados).toHaveLength(1);
    expect(enviados[0].to).toBe(DESTINATARIOS.cartera);
    expect(enviados[0].subject).toBe('[SIGI] Traslado a Cartera y Jurídica — incapacidad n.º 1');
    expect(enviados[0].text).toContain('Causal: Deterioro crediticio de la entidad');
    expect(enviados[0].text).toContain('Motivo: La entidad está en liquidación');
    expect(enviados[0].text).toContain('Colaborador: Ana María Gómez');
  });

  it('4A — exige mínimo 2 requerimientos (ya no solo advierte): con 0 o 1 no traslada ni avisa', async () => {
    expect((await errores(trasladar())).requerimientos).toBe('Para trasladar se necesitan mínimo 2 requerimientos: faltan 2.');
    await requerir(1);
    expect((await errores(trasladar())).requerimientos).toBe('Para trasladar se necesitan mínimo 2 requerimientos: falta 1.');
    expect(baseDeDatos.incapacidades[0].motivoTraslado ?? null).toBeNull();
    expect(enviados).toHaveLength(0);
    expect(await control.prepararRequerimientos('1')).toMatchObject({ puedeTrasladar: true, cumpleMinimo: false, faltan: 1 });
  });

  it('4A — la base vuelve a exigir los 2 requerimientos: si entre tanto ya no estaban, no traslada y lo explica', async () => {
    await requerir(1);
    await requerir(2);
    const guardar = baseDeDatos.guardarTraslado.bind(baseDeDatos);
    baseDeDatos.guardarTraslado = async (...args) => {
      baseDeDatos.requerimientos.splice(0, 1); // la base ya no tiene dos al guardar
      return guardar(...args);
    };
    expect((await errores(trasladar())).requerimientos).toBe('Para trasladar se necesitan mínimo 2 requerimientos.');
    expect(baseDeDatos.incapacidades[0].motivoTraslado ?? null).toBeNull();
    expect(enviados).toHaveLength(0);
  });

  it('4A — deterioro crediticio: se traslada aunque no haya demora', async () => {
    hoy = '2026-11-25'; // antes de la fecha prometida (1 dic)
    await requerir(1);
    await requerir(2);
    expect(await trasladar({ causal: 'deterioro' })).toMatchObject({ causal: 'deterioro' });
  });

  it('4A — requerimientos también sin demora (cambia DA-43)', async () => {
    hoy = '2026-11-25';
    expect(await requerir(1)).toMatchObject({ total: 1, cumpleMinimo: false });
    expect((await control.prepararRequerimientos('1')).puedeRegistrar).toBe(true);
  });

  it('4A — 180 días: se cuentan desde fecha_cobrada; el día 180 sí, el 179 no', async () => {
    await requerir(1);
    await requerir(2);
    hoy = '2027-05-19'; // 21 nov 2026 + 179
    const e = await errores(trasladar({ causal: '180_dias' }));
    expect(e.causal).toBe('Van 179 días desde que quedó cobrada (21 nov 2026): la causal «180 días sin pago» se puede desde el 20 may 2027.');
    expect(enviados).toHaveLength(0);
    hoy = '2027-05-20'; // + 180
    expect(await trasladar({ causal: '180_dias' })).toMatchObject({ causal: '180_dias' });
    expect(baseDeDatos.incapacidades[0].fechaTraslado).toBe('2027-05-20');
  });

  it('4A — los 180 días no se cuentan desde el inicio de la incapacidad (empezó el 3 nov)', () => {
    const cobrada = { estado: 'cobrada', fechaCobrada: '2026-11-21' };
    expect(impedimentoDeCausal(cobrada, '180_dias', '2027-05-02')).toMatch(/Van 162 días/); // 3 nov + 180 = 2 may: aún no
  });

  it('4A — rechazo: una rechazada tiene cobro persuasivo y, con 2 requerimientos, se traslada', async () => {
    await rechazada();
    expect(await control.prepararRequerimientos('2')).toMatchObject({ pendiente: true, puedeRegistrar: true, puedeTrasladar: true });
    await requerir(1, '2');
    await requerir(2, '2');
    const datos = await control.prepararRequerimientos('2');
    expect(datos.causalesDisponibles.map((c) => c.causal)).toEqual(['rechazo']);
    expect(await trasladar({ id: '2', causal: 'rechazo', motivo: 'La entidad no reconoce la epicrisis' })).toMatchObject({ causal: 'rechazo' });
    expect(baseDeDatos.incapacidades[1]).toMatchObject({ estado: 'rechazada', causalTraslado: 'rechazo' });
  });

  it('4A — cada causal solo en su estado: rechazo para rechazadas, 180 días y deterioro para cobradas', async () => {
    await requerir(1);
    await requerir(2);
    expect((await errores(trasladar({ causal: 'rechazo' }))).causal).toMatch(/que la entidad rechazó/);
    await rechazada();
    await requerir(1, '2');
    await requerir(2, '2');
    expect((await errores(trasladar({ id: '2', causal: 'deterioro' }))).causal).toMatch(/es para una incapacidad cobrada/);
    expect((await errores(trasladar({ id: '2', causal: '180_dias' }))).causal).toMatch(/es para una incapacidad cobrada/);
  });

  it('una causal que no es de la lista no se acepta', async () => {
    await requerir(1);
    await requerir(2);
    expect((await errores(trasladar({ causal: 'otra' }))).causal).toBe('Elija la causal del traslado.');
    expect((await errores(trasladar({ causal: '' }))).causal).toBe('Elija la causal del traslado.');
  });

  it('DA-44 — un solo traslado por incapacidad, y después no más requerimientos', async () => {
    await requerir(1);
    await requerir(2);
    await trasladar();
    expect((await errores(trasladar())).estado).toMatch(/ya se trasladó a Cartera y Jurídica el 4 dic 2026/);
    expect(enviados).toHaveLength(1);
    expect((await errores(requerir(3))).estado).toMatch(/ya se trasladó/);
    expect(await control.prepararRequerimientos('1')).toMatchObject({ trasladada: true, puedeTrasladar: false, puedeRegistrar: false });
  });

  it('una transcrita, una pagada o una dada de baja no tienen cobro persuasivo', async () => {
    await control.registrarIncapacidad(formularioDeRegistro({ correoColaborador: 'otro@correo.co' }), USUARIOS.receptor);
    await control.registrarRadicacion('2', { radicado: 'RAD-2', evidencia: PDF }, USUARIOS.auxiliar);
    expect((await errores(trasladar({ id: '2' }))).estado).toMatch(/aún no ha respondido/);
    expect((await errores(requerir(1, '2'))).estado).toMatch(/aún no ha respondido/);
    baseDeDatos.incapacidades[0].decision = 'dar_de_baja';
    expect((await errores(trasladar())).estado).toMatch(/dio de baja/);
    baseDeDatos.incapacidades[0].decision = null;
    await control.registrarPago('1', { valor: '1.000', fechaPago: '2026-12-04' }, USUARIOS.auxiliar);
    expect((await errores(trasladar())).estado).toMatch(/ya está pagada/);
    expect(enviados).toHaveLength(0);
  });

  it('DA-44 — si el correo falla se deshace el traslado (también la causal) y se puede reintentar', async () => {
    await requerir(1);
    await requerir(2);
    const fallido = crearControlIncapacidades({
      baseDeDatos,
      correo: { notificarTraslado: async () => { throw new Error('SMTP caído'); } },
      hoy: () => hoy,
    });
    await expect(fallido.trasladarACartera('1', { causal: 'deterioro', motivo: 'La entidad está en liquidación' })).rejects.toMatchObject({
      name: 'ErrorDeAviso', deshecho: true, cause: expect.objectContaining({ message: 'SMTP caído' }),
    });
    expect(baseDeDatos.incapacidades[0]).toMatchObject({ causalTraslado: null, motivoTraslado: null, fechaTraslado: null });
    expect(await trasladar()).toMatchObject({ idIncapacidad: 1 });
  });

  it('un motivo no válido no envía el correo ni guarda; los errores se dicen todos juntos', async () => {
    const e = await errores(trasladar({ causal: 'otra', motivo: '  ' }));
    expect(e).toMatchObject({ motivo: 'Escriba el motivo del traslado.', causal: 'Elija la causal del traslado.', requerimientos: expect.any(String) });
    expect(enviados).toHaveLength(0);
  });

  it('si a la vez se registró el pago, la transacción no guarda el traslado', async () => {
    await requerir(1);
    await requerir(2);
    const guardar = baseDeDatos.guardarTraslado.bind(baseDeDatos);
    baseDeDatos.guardarTraslado = async (...args) => {
      baseDeDatos.incapacidades[0].estado = 'pagada';
      return guardar(...args);
    };
    expect((await errores(trasladar())).estado).toMatch(/ya está pagada/);
    expect(baseDeDatos.incapacidades[0].motivoTraslado ?? null).toBeNull();
    expect(enviados).toHaveLength(0); // no sale un correo de más
  });

  it('si otro usuario trasladó a la vez, el mensaje lo dice', async () => {
    await requerir(1);
    await requerir(2);
    const guardar = baseDeDatos.guardarTraslado.bind(baseDeDatos);
    baseDeDatos.guardarTraslado = async (...args) => {
      await guardar(1, { causal: 'deterioro', motivo: 'Trasladada por otro auxiliar' }, '2026-12-04');
      return guardar(...args);
    };
    expect((await errores(trasladar())).estado).toMatch(/ya se trasladó/);
    expect(enviados).toHaveLength(0);
  });

  it('no existe o el número no es válido → null', async () => {
    expect(await trasladar({ id: '99' })).toBeNull();
    expect(await trasladar({ id: 'abc' })).toBeNull();
  });
});

describe('HU-19.CA2 — el pago posterior al traslado usa registrarPago (HU-15)', () => {
  it('HU-19.CA2 — trasladada y pendiente: la pantalla ofrece el pago, y registrarlo deja la incapacidad pagada', async () => {
    await requerir(1);
    await requerir(2);
    await trasladar();
    expect((await control.prepararRequerimientos('1')).puedeRegistrarPago).toBe(true);
    hoy = '2026-12-10';
    await control.registrarPago('1', { valor: '1.250.000', fechaPago: '2026-12-10' }, USUARIOS.auxiliar);
    expect(baseDeDatos.incapacidades[0].estado).toBe('pagada');
    expect(await control.prepararRequerimientos('1')).toMatchObject({ puedeRegistrarPago: false, trasladada: true });
  });

  it('4A — una rechazada trasladada por rechazo admite el pago si la entidad termina pagando; anulado, vuelve a rechazada', async () => {
    await rechazada();
    await requerir(1, '2');
    await requerir(2, '2');
    await trasladar({ id: '2', causal: 'rechazo' });
    expect((await control.prepararRequerimientos('2')).puedeRegistrarPago).toBe(true);
    const { idPago } = await control.registrarPago('2', { valor: '500.000', fechaPago: '2026-12-04' }, USUARIOS.auxiliar);
    expect(baseDeDatos.incapacidades[1].estado).toBe('pagada');
    await control.anularPago('2', String(idPago), { motivo: 'Valor mal digitado en el registro' }, USUARIOS.auxiliar);
    expect(baseDeDatos.incapacidades[1].estado).toBe('rechazada');
  });

  it('una rechazada sin traslado no admite el pago', async () => {
    await rechazada();
    expect((await errores(control.registrarPago('2', { valor: '500.000', fechaPago: '2026-12-04' }, USUARIOS.auxiliar))).estado).toBeDefined();
  });

  it('sin traslado no se ofrece el pago en esta pantalla', async () => {
    expect((await control.prepararRequerimientos('1')).puedeRegistrarPago).toBe(false);
  });
});

describe('DA-44 — validación del motivo (el detalle)', () => {
  it.each([
    ['', 'Escriba el motivo del traslado.'],
    ['ab', 'Escriba el motivo con al menos 3 caracteres.'],
    ['x'.repeat(501), 'El motivo admite hasta 500 caracteres.'],
    ['Motivo\u0000 con control', 'El motivo tiene caracteres no válidos.'],
  ])('motivo «%s…» no es válido', (texto, error) => {
    expect(leerMotivo(texto).error).toBe(error);
  });

  it.each([['abc'], ['x'.repeat(500)], ['😀😀😀'], ['180 días\nsin pago']])('%s sí es válido', (texto) => {
    expect(leerMotivo(texto).valor).toBe(texto);
  });

  it('un valor que no es texto no es válido', () => {
    expect(leerMotivo(undefined).error).toBeDefined();
  });
});

describe('DA-70 — una rechazada ya trasladada no se radica de nuevo', () => {
  const trasladarRechazada = async () => {
    await rechazada();
    await requerir(1, '2');
    await requerir(2, '2');
    await trasladar({ id: '2', causal: 'rechazo' });
  };

  it('la pantalla no ofrece radicar y el registro se rechaza sin guardar', async () => {
    await trasladarRechazada();
    expect((await control.prepararRadicacion('2')).puedeRadicar).toBe(false);
    const e = await errores(control.registrarRadicacion('2', { radicado: 'RAD-3', evidencia: PDF }, USUARIOS.auxiliar));
    expect(e.estado).toMatch(/ya se trasladó a Cartera y Jurídica/);
    expect(baseDeDatos.incapacidades[1].estado).toBe('rechazada');
    expect(baseDeDatos.radicaciones.filter((r) => r.idIncapacidad === 2)).toHaveLength(1);
  });

  it('sin traslado una rechazada sí se radica de nuevo (HU-10.CA2)', async () => {
    await rechazada();
    expect((await control.prepararRadicacion('2')).puedeRadicar).toBe(true);
  });

  it('ya no sale la alerta de transcripción de la trasladada', async () => {
    await trasladarRechazada();
    hoy = '2027-12-01'; // con el plazo de transcripción (1 año) vencido
    const { vencidas, porVencer } = await control.obtenerAlertas({ tipo: 'transcripcion' });
    expect([...vencidas, ...porVencer].map((a) => a.idIncapacidad)).not.toContain(2);
  });

  it('si otro usuario la trasladó entre la consulta y el registro, el mensaje lo dice', async () => {
    await rechazada();
    await requerir(1, '2');
    await requerir(2, '2');
    const obtener = baseDeDatos.obtenerDatosRadicacion.bind(baseDeDatos);
    let llamadas = 0;
    baseDeDatos.obtenerDatosRadicacion = async (id) => {
      if (llamadas++ === 0) {
        const antes = await obtener(id);
        await trasladar({ id: '2', causal: 'rechazo' });
        return antes; // la consulta vio la incapacidad sin trasladar
      }
      return obtener(id);
    };
    expect((await errores(control.registrarRadicacion('2', { radicado: 'RAD-3', evidencia: PDF }, USUARIOS.auxiliar))).estado).toMatch(/ya se trasladó/);
  });
});
