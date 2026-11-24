import { describe, expect, it } from 'vitest';
import { OPERACIONES, OPERACIONES_POR_ROL, puedeEjecutar, puedeVerDocumento } from '../../src/config/permisos.js';
import { TIPOS_DOCUMENTO } from '../../src/models/documento.model.js';
import { ROLES } from '../../src/models/usuario.model.js';

// Tabla «Permisos por rol» de docs/auditoria/03_decisiones.md, escrita aparte para comparar.
const ESPERADO = {
  registrarIncapacidad: ['receptor', 'auxiliar'],
  registrarDocumentos: ['receptor', 'auxiliar'],
  registrarReemplazo: ['lider'],
  registrarPagosConsignados: ['contabilidad'],
  registrarDecision: ['cartera'],
};
const SOLO_AUXILIAR = [
  'verificarDocumentacion', 'confirmarVerificacion', 'notificarFaltantes', 'registrarSegundoLlamado', 'verDocumento',
  'prepararRadicacion', 'registrarRadicacion', 'consultarEstados', 'consultarAlertas',
  'registrarCobrada', 'registrarRechazo', 'registrarPago',
  'consultarPendientesDePago', 'registrarSeguimiento', 'registrarAcuerdo',
  'registrarRequerimiento', 'trasladarACartera', 'calcularReconocimiento',
  'consultarReporteProlongadas', 'registrarConcepto', 'registrarFaltaConcepto', 'registrarSuspensionPago',
  'identificarPagos', 'generarReporte', 'consultarPagadas', 'archivarIncapacidad', 'registrarEnvioArchivo',
];
for (const operacion of SOLO_AUXILIAR) ESPERADO[operacion] = ['auxiliar'];

describe('HU-02 / DA-02 — permisos por rol', () => {
  it('la tabla cubre las 31 operaciones de la Vista más «ver documento» (DA-06)', () => {
    expect([...OPERACIONES].sort()).toEqual(Object.keys(ESPERADO).sort());
    expect(OPERACIONES).toHaveLength(32);
  });

  it('los roles de la tabla son los 5 roles con pantalla', () => {
    expect(Object.keys(OPERACIONES_POR_ROL).sort()).toEqual([...ROLES].sort());
  });

  it.each(Object.entries(ESPERADO))('DA-02 — %s solo la ejecuta su actor', (operacion, permitidos) => {
    for (const rol of ROLES) {
      expect(puedeEjecutar(rol, operacion), `${rol} → ${operacion}`).toBe(permitidos.includes(rol));
    }
  });

  it('un rol desconocido no puede nada y una operación desconocida es un error', () => {
    expect(puedeEjecutar('coordinacion', 'consultarEstados')).toBe(false);
    expect(() => puedeEjecutar('auxiliar', 'borrarTodo')).toThrow(/desconocida/);
  });

  it('HU-02.CA1 — ningún otro rol ve la historia clínica ni la epicrisis', () => {
    for (const rol of ROLES.filter((r) => r !== 'auxiliar')) {
      for (const tipo of TIPOS_DOCUMENTO) expect(puedeVerDocumento(rol, tipo), `${rol} → ${tipo}`).toBe(false);
    }
  });

  it('HU-02.CA2 — el auxiliar ve todos los documentos, incluidos los reservados', () => {
    for (const tipo of TIPOS_DOCUMENTO) expect(puedeVerDocumento('auxiliar', tipo)).toBe(true);
  });
});
