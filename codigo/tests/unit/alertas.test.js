// HU-12 — ver las alertas de plazos (DS-14, CU-09). Un test por cada tipo de plazo (DA-22).
// Fechas (DA-13, DA-37): hoy = jueves 19 nov 2026; el lunes 16 nov fue festivo.
import { beforeEach, describe, expect, it } from 'vitest';
import { calcularVencimientos, leerTipo, TIPOS_PLAZO } from '../../src/controllers/alertas.controller.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearBaseDeDatosFalsa } from '../helpers/base-de-datos-falsa.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { formularioDeRegistro } from '../helpers/fabricas.js';
import { USUARIOS } from '../helpers/sesion-falsa.js';

const HOY = '2026-11-19';

// Una incapacidad como la entrega consultarPlazos; por defecto, sin ninguna alerta.
const incapacidad = (cambios = {}) => ({
  idIncapacidad: 1,
  colaborador: 'Ana María Gómez',
  tipo: 'enfermedad_general',
  fechaInicio: '2026-11-03',
  diasIncapacidad: 5,
  fechaRecepcion: '2026-11-04',
  fechaNacimiento: null,
  estado: null,
  documentacionCompleta: null,
  fechaAvisoFaltantes: null,
  segundoLlamado: false,
  entidad: { nombre: 'Nueva EPS', plazoTranscripcion: '1 year', plazoTranscripcionTransito: null },
  ...cambios,
});

const alertas = (cambios, tipo) => calcularVencimientos([incapacidad(cambios)], HOY).filter((a) => !tipo || a.tipo.startsWith(tipo));

describe('HU-12.CA1 — calcula cada tipo de plazo', () => {
  it('sin plazos cerca: ninguna alerta', () => {
    expect(alertas({})).toEqual([]);
  });

  it('envío (2 días): llegó tarde = vencido mientras siga sin radicar', () => {
    expect(alertas({ fechaInicio: '2026-11-12', fechaRecepcion: '2026-11-17' }, 'envio')).toEqual([
      expect.objectContaining({ tipo: 'envio', estado: 'vencido', fechaLimite: '2026-11-14', diasTarde: 3, fechaRecepcion: '2026-11-17' }),
    ]);
    // A tiempo (el día límite cuenta) o ya radicada: sin alerta.
    expect(alertas({ fechaInicio: '2026-11-12', fechaRecepcion: '2026-11-14' }, 'envio')).toEqual([]);
    expect(alertas({ fechaInicio: '2026-11-12', fechaRecepcion: '2026-11-17', estado: 'transcrita' }, 'envio')).toEqual([]);
  });

  it('subsanación (3 días hábiles desde el aviso, con festivos): por vencer y vencido', () => {
    // Aviso mié 18 → jue 19, vie 20, lun 23: quedan 2 días hábiles (20 y 23).
    expect(alertas({ documentacionCompleta: false, fechaAvisoFaltantes: '2026-11-18' }, 'subsanacion')).toEqual([
      expect.objectContaining({ estado: 'por_vencer', fechaLimite: '2026-11-23', diasHabiles: 2, fechaAviso: '2026-11-18' }),
    ]);
    // Aviso jue 12 → vie 13, (lun 16 festivo) mar 17, mié 18: venció ayer.
    expect(alertas({ documentacionCompleta: false, fechaAvisoFaltantes: '2026-11-12' }, 'subsanacion')).toEqual([
      expect.objectContaining({ estado: 'vencido', fechaLimite: '2026-11-18', dias: -1 }),
    ]);
  });

  it('subsanación: deja de mostrarse con el segundo llamado o cuando llegan documentos (DA-37)', () => {
    const aviso = { fechaAvisoFaltantes: '2026-11-12' };
    expect(alertas({ ...aviso, documentacionCompleta: false, segundoLlamado: true }, 'subsanacion')).toEqual([]);
    expect(alertas({ ...aviso, documentacionCompleta: null }, 'subsanacion')).toEqual([]);
  });

  it('transcripción (plazo de la entidad desde el inicio): por vencer, vencido y tras un rechazo', () => {
    expect(alertas({ fechaInicio: '2025-11-21' }, 'transcripcion')).toEqual([
      expect.objectContaining({ estado: 'por_vencer', fechaLimite: '2026-11-21', dias: 2, duracion: '12 meses', rechazada: false }),
    ]);
    expect(alertas({ fechaInicio: '2025-11-10', estado: 'rechazada' }, 'transcripcion')).toEqual([
      expect.objectContaining({ estado: 'vencido', fechaLimite: '2026-11-10', dias: -9, rechazada: true }),
    ]);
    // Accidente de tránsito con plazo propio de la entidad (15 días).
    const transito = { tipo: 'accidente_transito', fechaInicio: '2026-11-10', entidad: { nombre: 'Salud Total', plazoTranscripcion: '1 year', plazoTranscripcionTransito: '15 days' } };
    // Límite 25 nov: faltan 6 días, todavía al día.
    expect(alertas(transito, 'transcripcion')).toEqual([]);
    expect(alertas({ ...transito, fechaInicio: '2026-11-08' }, 'transcripcion')).toEqual([
      expect.objectContaining({ estado: 'por_vencer', fechaLimite: '2026-11-23', dias: 4 }),
    ]);
    // Ya radicada, o sin plazo registrado en la entidad: sin alerta.
    expect(alertas({ fechaInicio: '2025-11-10', estado: 'transcrita' }, 'transcripcion')).toEqual([]);
    expect(alertas({ fechaInicio: '2025-11-10', fechaRecepcion: '2025-11-11', entidad: { nombre: 'X', plazoTranscripcion: null, plazoTranscripcionTransito: null } })).toEqual([]);
  });

  it('licencia de paternidad (30 días desde el nacimiento): una sola alerta, no también de transcripción', () => {
    const paternidad = { tipo: 'licencia_paternidad', fechaInicio: '2026-10-25', diasIncapacidad: 14, fechaRecepcion: '2026-10-26' };
    expect(alertas({ ...paternidad, fechaNacimiento: '2026-10-22' })).toEqual([
      expect.objectContaining({ tipo: 'paternidad', estado: 'por_vencer', fechaLimite: '2026-11-21', base: 'nacimiento' }),
    ]);
    // Sin fecha de nacimiento se cuenta desde el inicio (DA-35).
    expect(alertas({ ...paternidad, fechaInicio: '2026-10-15', fechaRecepcion: '2026-10-16' })).toEqual([
      expect.objectContaining({ tipo: 'paternidad', estado: 'vencido', fechaLimite: '2026-11-14', base: 'inicio' }),
    ]);
  });

  it('hito de 90 días: se cumple el día 90 (inicio + 89); por vencer 5 días antes', () => {
    expect(alertas({ fechaInicio: '2026-08-24', diasIncapacidad: 120, estado: 'transcrita' }, 'hito')).toEqual([
      expect.objectContaining({ tipo: 'hito90', estado: 'por_vencer', fechaLimite: '2026-11-21', dias: 2, diasIncapacidad: 120 }),
    ]);
    // El mismo día del hito: «por vencer» con 0 días (se cumple hoy).
    expect(alertas({ fechaInicio: '2026-08-22', diasIncapacidad: 90, estado: 'transcrita' }, 'hito')).toEqual([
      expect.objectContaining({ tipo: 'hito90', estado: 'por_vencer', fechaLimite: HOY, dias: 0 }),
    ]);
  });

  it('hito de 120 días: cumplido = vencido, mientras la incapacidad esté vigente', () => {
    expect(alertas({ fechaInicio: '2026-07-15', diasIncapacidad: 150, estado: 'cobrada' }, 'hito')).toEqual([
      expect.objectContaining({ tipo: 'hito120', estado: 'vencido', fechaLimite: '2026-11-11', dias: -8 }),
    ]);
  });

  it('hito de 150 días: muestra solo el último cumplido, no los anteriores', () => {
    expect(alertas({ fechaInicio: '2026-06-20', diasIncapacidad: 170, estado: 'transcrita' }, 'hito')).toEqual([
      expect.objectContaining({ tipo: 'hito150', estado: 'vencido', fechaLimite: '2026-11-16' }),
    ]);
  });

  it('hito de 180 días: el próximo por vencer reemplaza al último cumplido', () => {
    // Inicio 28 may: el 150 se cumplió el 24 oct; el 180 se cumple el lun 23 nov.
    expect(alertas({ fechaInicio: '2026-05-28', diasIncapacidad: 200, estado: 'transcrita' }, 'hito')).toEqual([
      expect.objectContaining({ tipo: 'hito180', estado: 'por_vencer', fechaLimite: '2026-11-23', dias: 4 }),
    ]);
  });

  it('hitos: no aplican si la incapacidad no llega al hito o ya terminó (DA-37)', () => {
    expect(alertas({ fechaInicio: '2026-08-24', diasIncapacidad: 89, estado: 'transcrita' }, 'hito')).toEqual([]);
    // 100 días desde el 15 jul: terminó el 22 oct.
    expect(alertas({ fechaInicio: '2026-07-15', diasIncapacidad: 100, estado: 'transcrita' }, 'hito')).toEqual([]);
  });

  it('ordena por fecha límite y una incapacidad puede tener varias alertas', () => {
    const lista = calcularVencimientos(
      [
        incapacidad({ idIncapacidad: 2, fechaInicio: '2025-11-21', fechaRecepcion: '2025-11-22' }),
        incapacidad({ idIncapacidad: 3, fechaInicio: '2026-11-12', fechaRecepcion: '2026-11-17', documentacionCompleta: false, fechaAvisoFaltantes: '2026-11-18' }),
      ],
      HOY,
    );
    expect(lista.map((a) => [a.idIncapacidad, a.tipo])).toEqual([
      [3, 'envio'],
      [2, 'transcripcion'],
      [3, 'subsanacion'],
    ]);
  });

  it('leerTipo: solo acepta los 8 tipos; lo demás es «todos»', () => {
    expect(TIPOS_PLAZO).toHaveLength(8);
    expect(leerTipo({ tipo: 'hito90' })).toBe('hito90');
    expect(leerTipo({ tipo: ['envio', 'x'] })).toBe('envio');
    expect(leerTipo({ tipo: 'otro' })).toBe('');
    expect(leerTipo({})).toBe('');
  });
});

describe('HU-12 — obtenerAlertas (Control con persistencia falsa)', () => {
  let baseDeDatos;
  let control;

  const registrar = async (cambios, extra = {}) => {
    const { idIncapacidad } = await control.registrarIncapacidad(formularioDeRegistro(cambios), USUARIOS.receptor);
    Object.assign(baseDeDatos.incapacidades.find((i) => i.idIncapacidad === idIncapacidad), extra);
  };

  // 1 sin alertas · 2 envío tarde (vencido) · 3 transcripción por vencer · 4 hito 90 por vencer (transcrita)
  beforeEach(async () => {
    baseDeDatos = crearBaseDeDatosFalsa();
    control = crearControlIncapacidades({ baseDeDatos, correo: crearCorreoFalso().correo, hoy: () => HOY });
    await registrar({});
    await registrar({ fechaInicio: '2026-11-12', fechaRecepcion: '2026-11-17' });
    await registrar({ fechaInicio: '2025-11-21', fechaRecepcion: '2025-11-22' });
    await registrar({ fechaInicio: '2026-08-24', fechaRecepcion: '2026-08-25', diasIncapacidad: '120' }, { estado: 'transcrita' });
  });

  it('HU-12.CA1 — separa vencidas y por vencer, con los conteos por tipo', async () => {
    const r = await control.obtenerAlertas({});
    expect(r.hoy).toBe(HOY);
    expect(r.tipo).toBe('');
    expect(r.total).toBe(3);
    expect(r.vencidas.map((a) => [a.idIncapacidad, a.tipo])).toEqual([[2, 'envio']]);
    expect(r.porVencer.map((a) => [a.idIncapacidad, a.tipo])).toEqual([[3, 'transcripcion'], [4, 'hito90']]);
    expect(r.conteos).toEqual({ envio: 1, subsanacion: 0, transcripcion: 1, paternidad: 0, hito90: 1, hito120: 0, hito150: 0, hito180: 0 });
    expect(r.porVencer[0]).toMatchObject({ colaborador: 'Ana María Gómez', entidad: 'Nueva EPS' });
  });

  it('HU-12.CA1 — filtra por tipo de plazo sin cambiar los conteos', async () => {
    const r = await control.obtenerAlertas({ tipo: 'hito90' });
    expect(r.tipo).toBe('hito90');
    expect(r.vencidas).toEqual([]);
    expect(r.porVencer.map((a) => a.idIncapacidad)).toEqual([4]);
    expect(r.total).toBe(3);
    expect((await control.obtenerAlertas({ tipo: 'nada' })).porVencer).toHaveLength(2);
  });

  it('HU-12.CA2 — solo informa: no cambia ningún dato', async () => {
    const antes = structuredClone(baseDeDatos.incapacidades);
    await control.obtenerAlertas({});
    expect(baseDeDatos.incapacidades).toEqual(antes);
  });
});
