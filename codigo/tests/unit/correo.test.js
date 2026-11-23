import { describe, expect, it } from 'vitest';
import { crearCorreoFalso, DESTINATARIOS } from '../helpers/correo-falso.js';
import { incapacidadDePrueba } from '../helpers/fabricas.js';

const inc = incapacidadDePrueba();
const pagos = [{ colaborador: 'Ana María Gómez', diasPagados: 3, valor: 150000 }];
const filas = [{ colaborador: 'Ana María Gómez', tipo: 'enfermedad_general', entidad: 'Nueva EPS', fechaInicio: '2026-11-03', fechaFin: '2026-11-07', diasIncapacidad: 5, diasEnPeriodo: 5, estado: 'registrada' }];

// Las 13 notificaciones del diseño con su destinatario (CONTEXTO §8).
const casos = [
  ['notificarRecepcion', (c) => c.notificarRecepcion(inc), DESTINATARIOS.auxiliar],
  ['notificarFaltantes', (c) => c.notificarFaltantes(inc, ['Epicrisis'], '2026-11-10'), inc.correoColaborador],
  ['notificarCitacion', (c) => c.notificarCitacion({ ...inc, faltantes: ['Epicrisis'] }), DESTINATARIOS.coordinacion],
  ['notificarRetraso', (c) => c.notificarRetraso({ ...inc, tiempoPago: 30 }), DESTINATARIOS.coordinacion],
  ['notificarTraslado', (c) => c.notificarTraslado(inc, '180 días sin pago'), DESTINATARIOS.cartera],
  ['comunicarConcepto', (c) => c.comunicarConcepto(inc), inc.correoColaborador],
  ['avisarFaltaConcepto', (c) => c.avisarFaltaConcepto(inc), inc.correoColaborador],
  ['notificarSuspensionPago', (c) => c.notificarSuspensionPago(inc), inc.correoColaborador],
  ['notificarPagosPorIdentificar', (c) => c.notificarPagosPorIdentificar('Nueva EPS', 2), DESTINATARIOS.auxiliar],
  ['enviarDetalleConciliado', (c) => c.enviarDetalleConciliado('Nueva EPS', pagos), DESTINATARIOS.contabilidad],
  ['notificarSaldosPendientes', (c) => c.notificarSaldosPendientes('Nueva EPS', pagos), DESTINATARIOS.contabilidad],
  ['enviarReporteAusentismo', (c) => c.enviarReporteAusentismo('2026-11', filas), DESTINATARIOS.sgsst],
  ['enviarParaArchivo', (c) => c.enviarParaArchivo(inc), DESTINATARIOS.gestionDocumental],
];

describe('T-00d — servicio de correo', () => {
  it('tiene exactamente las 13 notificaciones del diseño', () => {
    const { correo } = crearCorreoFalso();
    expect(Object.keys(correo).sort()).toEqual(casos.map(([nombre]) => nombre).sort());
  });

  it.each(casos)('%s llega a su destinatario, sin adjuntos', async (_nombre, enviar, destinatario) => {
    const { correo, enviados } = crearCorreoFalso();
    await enviar(correo);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].to).toBe(destinatario);
    expect(enviados[0].subject).toMatch(/^\[SIGI\] /);
    expect(enviados[0].text.length).toBeGreaterThan(20);
    expect(enviados[0].attachments).toBeUndefined();
  });

  it('notificarFaltantes lista los documentos y da 3 días hábiles', async () => {
    const { correo, enviados } = crearCorreoFalso();
    await correo.notificarFaltantes(inc, ['Epicrisis', 'FURIPS'], '2026-11-10');
    expect(enviados[0].text).toContain('- Epicrisis');
    expect(enviados[0].text).toContain('- FURIPS');
    expect(enviados[0].text).toContain('3 días hábiles');
    expect(enviados[0].text).toContain('2026-11-10');
  });

  it('notificarRetraso dice el tiempo de pago en días, con singular para 1 (DA-38)', async () => {
    const { correo, enviados } = crearCorreoFalso();
    await correo.notificarRetraso({ ...inc, tiempoPago: 30 });
    await correo.notificarRetraso({ ...inc, tiempoPago: 1 });
    await correo.notificarRetraso({ ...inc, tiempoPago: null });
    expect(enviados[0].text).toContain('Tiempo de pago informado: 30 días');
    expect(enviados[1].text).toContain('Tiempo de pago informado: 1 día\n');
    expect(enviados[2].text).toContain('Tiempo de pago informado: sin dato');
  });

  it('notificarTraslado incluye el motivo', async () => {
    const { correo, enviados } = crearCorreoFalso();
    await correo.notificarTraslado(inc, 'Deterioro crediticio de la entidad');
    expect(enviados[0].text).toContain('Deterioro crediticio de la entidad');
  });

  it('el aviso del concepto no lleva el texto clínico del concepto (DA-52, CAR-11)', async () => {
    const { correo, enviados } = crearCorreoFalso();
    await correo.comunicarConcepto(inc, 'Concepto desfavorable: secuelas neurológicas');
    expect(enviados[0].text).not.toContain('secuelas');
    expect(enviados[0].html).not.toContain('secuelas');
    expect(enviados[0].text).toContain('Gestión Humana');
  });

  it('escapa el HTML de los datos escritos por los usuarios', async () => {
    const { correo, enviados } = crearCorreoFalso();
    await correo.notificarTraslado(inc, '<script>alert(1)</script>');
    expect(enviados[0].html).not.toContain('<script>');
    expect(enviados[0].html).toContain('&lt;script&gt;');
  });

  it('falla si el colaborador no tiene correo', async () => {
    const { correo } = crearCorreoFalso();
    await expect(correo.avisarFaltaConcepto({ ...inc, correoColaborador: null })).rejects.toThrow(/destinatario/);
  });
});
