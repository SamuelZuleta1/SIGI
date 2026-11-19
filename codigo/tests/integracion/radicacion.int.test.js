// HU-09 contra Supabase (nube): obtenerDatosRadicacion con los plazos reales del seed (§5.2.1, P-C).
// Requisitos: proyecto vinculado y `npm run db:usuarios`. Sin migración: las columnas vienen del esquema inicial.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearClienteServidor } from '../../src/config/supabase.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearBaseDeDatos } from '../../src/persistence/base-de-datos.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { formularioDeRegistro } from '../helpers/fabricas.js';

const servidor = crearClienteServidor();
const baseDeDatos = crearBaseDeDatos(servidor);
const control = crearControlIncapacidades({ baseDeDatos, correo: crearCorreoFalso().correo, hoy: () => '2026-11-19' });

const correoColaborador = `prueba.radicacion.${Date.now()}@sigi.test`;
const ids = [];
let receptor;
let entidades;

const registrar = async (nombreEntidad, cambios = {}) => {
  const entidad = entidades.find((e) => e.nombre === nombreEntidad);
  const { idIncapacidad } = await control.registrarIncapacidad(
    formularioDeRegistro({ correoColaborador, entidad: String(entidad.id), ...cambios }),
    receptor,
  );
  ids.push(idIncapacidad);
  return idIncapacidad;
};

beforeAll(async () => {
  const { data, error } = await servidor.from('usuario').select('id, correo, rol').eq('correo', 'receptor1@sigi.test').maybeSingle();
  if (error || !data) throw new Error('Faltan los usuarios de demostración: ejecute `npm run db:usuarios`');
  receptor = data;
  entidades = await baseDeDatos.consultarEntidades();
});

afterAll(async () => {
  if (ids.length) await servidor.from('incapacidad').delete().in('id', ids);
  await servidor.from('colaborador').delete().eq('correo', correoColaborador);
});

describe('HU-09 — preparar la radicación (base de datos)', () => {
  it('HU-09.CA1 — obtenerDatosRadicacion trae la entidad con sus plazos como texto de Postgres', async () => {
    const id = await registrar('Salud Total', { tipo: 'accidente_transito', fechaInicio: '2026-11-10' });
    const datos = await baseDeDatos.obtenerDatosRadicacion(id);
    expect(datos).toMatchObject({
      idIncapacidad: id,
      tipo: 'accidente_transito',
      fechaInicio: '2026-11-10',
      fechaNacimiento: null,
      estado: null,
      archivadoDigital: false,
      entidad: { nombre: 'Salud Total', tipo: 'EPS', plazoTranscripcion: '1 year', plazoTranscripcionTransito: '15 days', permiteTranscripcionDigital: true },
    });
  });

  it('HU-09.CA1 — Salud Total, tránsito: 15 días; SURA EPS: 150 días; Sanitas: 3 años y por correo', async () => {
    const transito = await control.prepararRadicacion(await registrar('Salud Total', { tipo: 'accidente_transito', fechaInicio: '2026-11-10' }));
    expect(transito.plazo).toMatchObject({ regla: 'transito', fechaLimite: '2026-11-25', estado: 'al_dia' });

    const sura = await control.prepararRadicacion(await registrar('SURA EPS', { fechaInicio: '2026-06-01' }));
    expect(sura.plazo).toMatchObject({ duracion: '150 días', fechaLimite: '2026-10-29', estado: 'vencido' });

    const sanitas = await control.prepararRadicacion(await registrar('Sanitas', { fechaInicio: '2026-11-03' }));
    expect(sanitas.entidad.permiteTranscripcionDigital).toBe(false);
    expect(sanitas.plazo).toMatchObject({ duracion: '3 años', fechaLimite: '2029-11-03' });
  });

  it('no existe → null', async () => {
    expect(await baseDeDatos.obtenerDatosRadicacion(2_000_000_000)).toBeNull();
  });
});
