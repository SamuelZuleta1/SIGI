// HU-09 y HU-10 contra Supabase (nube): obtenerDatosRadicacion con los plazos reales del seed (§5.2.1, P-C) y
// guardarRadicacion con la función registrar_radicacion (migración 20261119223120) y el bucket privado.
// Requisitos: proyecto vinculado, migraciones aplicadas y `npm run db:usuarios`.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BUCKET_DOCUMENTOS, crearClienteServidor } from '../../src/config/supabase.js';
import { crearControlIncapacidades } from '../../src/controllers/control-incapacidades.js';
import { crearBaseDeDatos } from '../../src/persistence/base-de-datos.js';
import { crearCorreoFalso } from '../helpers/correo-falso.js';
import { formularioDeRegistro, PDF, PNG } from '../helpers/fabricas.js';

const servidor = crearClienteServidor();
const baseDeDatos = crearBaseDeDatos(servidor);
const control = crearControlIncapacidades({ baseDeDatos, correo: crearCorreoFalso().correo, hoy: () => '2026-11-19' });

const correoColaborador = `prueba.radicacion.${Date.now()}@sigi.test`;
const ids = [];
let receptor;
let auxiliar;
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
  const aux = await servidor.from('usuario').select('id, correo, rol').eq('rol', 'auxiliar').limit(1).maybeSingle();
  if (aux.error || !aux.data) throw new Error('Falta un usuario auxiliar de demostración: ejecute `npm run db:usuarios`');
  auxiliar = aux.data;
  entidades = await baseDeDatos.consultarEntidades();
});

afterAll(async () => {
  if (ids.length) {
    // Las evidencias quedan en el bucket: se borran antes de que la cascada borre sus rutas.
    const { data } = await servidor.from('radicacion').select('evidencia').in('incapacidad_id', ids);
    const rutas = (data ?? []).map((r) => r.evidencia).filter(Boolean);
    if (rutas.length) await servidor.storage.from(BUCKET_DOCUMENTOS).remove(rutas);
    await servidor.from('incapacidad').delete().in('id', ids);
  }
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

describe('HU-10 — registrar la radicación (base de datos)', () => {
  it('HU-10.CA1 — guarda la radicación y la evidencia y pone estado = transcrita en la misma transacción', async () => {
    const id = await registrar('Nueva EPS');
    const { idRadicacion } = await control.registrarRadicacion(id, { radicado: ' NEPS-INT-1 ', evidencia: PDF }, auxiliar);

    const { data: incapacidad } = await servidor.from('incapacidad').select('estado').eq('id', id).single();
    expect(incapacidad.estado).toBe('transcrita');
    const { data: fila } = await servidor.from('radicacion').select('incapacidad_id, radicado, evidencia, creado_por').eq('id', idRadicacion).single();
    expect(fila).toMatchObject({ incapacidad_id: id, radicado: 'NEPS-INT-1', creado_por: auxiliar.id });
    expect(fila.evidencia).toMatch(new RegExp(`^incapacidades/${id}/radicacion-[0-9a-f-]{36}\\.pdf$`));

    const radicacion = await control.obtenerRadicacion(idRadicacion);
    const { contenido, tipoMime } = await control.verEvidencia(radicacion);
    expect(tipoMime).toBe('application/pdf');
    expect(contenido.equals(PDF)).toBe(true);
  });

  it('HU-10.CA2 — DA-36: ya transcrita, la función no guarda otra y no deja el archivo en el bucket', async () => {
    const id = await registrar('Nueva EPS');
    await control.registrarRadicacion(id, { radicado: 'NEPS-INT-2', evidencia: PDF }, auxiliar);
    // Directo a la persistencia, como si dos usuarios hubieran pasado la validación a la vez.
    expect(await baseDeDatos.guardarRadicacion(id, { radicado: 'NEPS-INT-3', contenido: PNG, tipoMime: 'image/png' }, auxiliar.id)).toBeNull();

    const { data: filas } = await servidor.from('radicacion').select('radicado').eq('incapacidad_id', id);
    expect(filas.map((f) => f.radicado)).toEqual(['NEPS-INT-2']);
    const { data: archivos } = await servidor.storage.from(BUCKET_DOCUMENTOS).list(`incapacidades/${id}`);
    expect(archivos.filter((a) => a.name.startsWith('radicacion-'))).toHaveLength(1);
  });

  it('HU-10.CA2 — rechazada: una nueva radicación vuelve a transcrita y quedan las dos, en orden', async () => {
    const id = await registrar('Nueva EPS');
    await control.registrarRadicacion(id, { radicado: 'NEPS-INT-4', evidencia: PDF }, auxiliar);
    await servidor.from('incapacidad').update({ estado: 'rechazada', causal_rechazo: 'Soporte ilegible' }).eq('id', id); // HU-14 llega en T-14
    await control.registrarRadicacion(id, { radicado: 'NEPS-INT-5', evidencia: PNG }, auxiliar);

    const datos = await baseDeDatos.obtenerDatosRadicacion(id);
    expect(datos.estado).toBe('transcrita');
    expect(datos.causalRechazo).toBe('Soporte ilegible');
    expect(datos.radicaciones.map((r) => r.radicado)).toEqual(['NEPS-INT-4', 'NEPS-INT-5']);
    expect(datos.radicaciones.every((r) => r.conEvidencia)).toBe(true);
  });

  it('la restricción de la tabla rechaza un radicado vacío', async () => {
    const id = await registrar('Nueva EPS');
    const { error } = await servidor.rpc('registrar_radicacion', { p_incapacidad_id: id, p_radicado: '   ', p_evidencia: null, p_creado_por: auxiliar.id });
    expect(error?.code).toBe('23514');
    const { data } = await servidor.from('incapacidad').select('estado').eq('id', id).single();
    expect(data.estado).toBeNull(); // la transacción completa se deshizo
  });
});
