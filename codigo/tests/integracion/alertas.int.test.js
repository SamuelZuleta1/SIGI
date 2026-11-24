// HU-12 contra Supabase (nube): consultarPlazos trae las incapacidades con algún plazo que vigilar (DA-37)
// y el Control calcula sus alertas. Solo lectura; las aserciones se acotan a los ids creados aquí.
// Requisitos: proyecto vinculado, migraciones aplicadas y `npm run db:usuarios`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearClienteServidor } from '../../src/config/supabase.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearBaseDeDatos } from '../../src/persistence/base-de-datos.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { formularioDeRegistro } from '../helpers/fabricas.js';

const servidor = crearClienteServidor();
const baseDeDatos = crearBaseDeDatos(servidor);
const control = crearControlIncapacidades({ baseDeDatos, correo: crearCorreoFalso().correo, hoy: () => '2026-11-19' });

const marca = Date.now();
const nombre = `Prueba Alertas ${marca}`;
const correoColaborador = `prueba.alertas.${marca}@sigi.test`;
const ids = [];

beforeAll(async () => {
  const { data: receptor, error } = await servidor.from('usuario').select('id, correo, rol').eq('correo', 'receptor1@sigi.test').maybeSingle();
  if (error || !receptor) throw new Error('Faltan los usuarios de demostración: ejecute `npm run db:usuarios`');
  const nuevaEps = String((await baseDeDatos.consultarEntidades()).find((e) => e.nombre === 'Nueva EPS').id);
  // 0 transcripción por vencer · 1 subsanación vencida (transcrita) · 2 hito 90 por vencer (cobrada) · 3 transcrita, sin plazos
  for (const [cambios, columnas] of [
    [{ fechaInicio: '2025-11-21', fechaRecepcion: '2025-11-22' }, null],
    [{ fechaInicio: '2026-11-03', fechaRecepcion: '2026-11-04' }, { estado: 'transcrita', documentacion_completa: false, fecha_aviso_faltantes: '2026-11-12', faltantes: ['epicrisis'] }],
    [{ fechaInicio: '2026-08-24', fechaRecepcion: '2026-08-25', diasIncapacidad: '120' }, { estado: 'cobrada', tiempo_pago: 30, fecha_cobrada: '2026-08-30' }], // una cobrada lleva su tiempo de pago (DA-38)
    [{ fechaInicio: '2026-11-03', fechaRecepcion: '2026-11-04' }, { estado: 'transcrita' }],
  ]) {
    const { idIncapacidad } = await control.registrarIncapacidad(
      formularioDeRegistro({ colaborador: nombre, correoColaborador, entidad: nuevaEps, ...cambios }),
      receptor,
    );
    ids.push(idIncapacidad);
    if (columnas) {
      const { error: e } = await servidor.from('incapacidad').update(columnas).eq('id', idIncapacidad);
      if (e) throw e;
    }
  }
});

afterAll(async () => {
  if (ids.length) await servidor.from('incapacidad').delete().in('id', ids);
  await servidor.from('colaborador').delete().eq('correo', correoColaborador);
});

describe('HU-12 — alertas de plazos (base de datos)', () => {
  it('DA-37 — consultarPlazos trae las candidatas con su entidad y deja fuera la transcrita sin plazos', async () => {
    const propias = (await baseDeDatos.consultarPlazos()).filter((i) => ids.includes(i.idIncapacidad));
    expect(propias.map((i) => i.idIncapacidad)).toEqual(ids.slice(0, 3));
    expect(propias[1]).toMatchObject({
      colaborador: nombre,
      estado: 'transcrita',
      documentacionCompleta: false,
      fechaAvisoFaltantes: '2026-11-12',
      segundoLlamado: false,
      entidad: { nombre: 'Nueva EPS', plazoTranscripcion: expect.any(String) },
    });
  });

  it('HU-12.CA1 — calcula y separa las alertas de cada una', async () => {
    const r = await control.obtenerAlertas({});
    const propias = (lista) => lista.filter((a) => ids.includes(a.idIncapacidad)).map((a) => [a.idIncapacidad, a.tipo]);
    expect(propias(r.vencidas)).toEqual([[ids[1], 'subsanacion']]);
    expect(propias(r.porVencer)).toEqual([[ids[0], 'transcripcion'], [ids[2], 'hito90']]);
  });
});
