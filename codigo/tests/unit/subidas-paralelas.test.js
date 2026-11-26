// Lectura y guardado en paralelo de los archivos (DA-72): si algo falla a la mitad, no quedan archivos sueltos.
import { describe, expect, it, vi } from 'vitest';
import { crearPersistenciaRegistro } from '../../src/persistence/registro.persistence.js';
import { archivosDePeticion } from '../../src/routes/subidas.js';
import { PDF } from '../helpers/fabricas.js';

const pdf = (tipo) => ({ tipo, contenido: PDF, tipoMime: 'application/pdf' });

describe('guardarDocumentos en paralelo', () => {
  it('si una subida falla, borra las que sí subieron, no registra nada y propaga el error', async () => {
    const cliente = { rpc: vi.fn() };
    const almacen = {
      guardar: vi.fn(async (ruta) => {
        if (ruta.includes('/epicrisis-')) throw new Error('Storage caído');
      }),
      eliminar: vi.fn(async () => {}),
    };
    const persistencia = crearPersistenciaRegistro(cliente, almacen);

    await expect(persistencia.guardarDocumentos(7, [pdf('soporte_incapacidad'), pdf('epicrisis'), pdf('furips')], 'u')).rejects.toThrow('Storage caído');
    expect(almacen.guardar).toHaveBeenCalledTimes(3); // se intentaron todos a la vez
    expect(cliente.rpc).not.toHaveBeenCalled();
    const [borradas] = almacen.eliminar.mock.calls[0];
    expect(borradas).toHaveLength(2);
    expect(borradas.every((ruta) => /^incapacidades\/7\/(soporte_incapacidad|furips)-[0-9a-f-]{36}\.pdf$/.test(ruta))).toBe(true);
  });

  it('si la base rechaza el registro, borra todos los archivos subidos', async () => {
    const cliente = { rpc: vi.fn(async () => ({ data: null, error: { code: '23514' } })) };
    const almacen = { guardar: vi.fn(async () => {}), eliminar: vi.fn(async () => {}) };
    const persistencia = crearPersistenciaRegistro(cliente, almacen);

    await expect(persistencia.guardarDocumentos(7, [pdf('soporte_incapacidad'), pdf('furips')], 'u')).rejects.toMatchObject({ code: '23514' });
    expect(almacen.eliminar.mock.calls[0][0]).toHaveLength(2);
  });

  it('con todo bien registra en el orden recibido', async () => {
    const cliente = { rpc: vi.fn(async () => ({ data: null, error: null })) };
    const almacen = { guardar: vi.fn(async () => {}), eliminar: vi.fn(async () => {}) };
    const persistencia = crearPersistenciaRegistro(cliente, almacen);

    const guardados = await persistencia.guardarDocumentos(7, [pdf('soporte_incapacidad'), pdf('epicrisis')], 'u');
    expect(guardados.map((d) => d.tipo)).toEqual(['soporte_incapacidad', 'epicrisis']);
    expect(cliente.rpc.mock.calls[0][1].p_documentos.map((d) => d.tipo)).toEqual(['soporte_incapacidad', 'epicrisis']);
    expect(almacen.eliminar).not.toHaveBeenCalled();
  });
});

describe('archivosDePeticion en paralelo', () => {
  const usuario = { id: 'u1' };

  it('si una lectura falla, borra todas las subidas de la petición y propaga el error', async () => {
    const control = {
      leerSubida: vi.fn(async (ruta) => {
        if (ruta === 'pendientes/u1/b') throw new Error('Storage caído');
        return PDF;
      }),
      descartarSubidas: vi.fn(async () => {}),
    };
    const req = { usuario, body: { subida_a: 'pendientes/u1/a', subida_b: 'pendientes/u1/b' } };

    await expect(archivosDePeticion(control, req, ['a', 'b'])).rejects.toThrow('Storage caído');
    expect(control.descartarSubidas).toHaveBeenCalledWith(expect.arrayContaining(['pendientes/u1/a', 'pendientes/u1/b']), usuario);
  });

  it('separa los archivos leídos de los que no llegaron, sin borrar nada (eso lo hace la ruta)', async () => {
    const control = { leerSubida: vi.fn(async (ruta) => (ruta.endsWith('a') ? PDF : null)), descartarSubidas: vi.fn() };
    const req = { usuario, body: { subida_a: 'pendientes/u1/a', subida_b: 'pendientes/u1/b' } };

    const { archivos, rutas, perdidos } = await archivosDePeticion(control, req, ['a', 'b', 'c']);
    expect(Object.keys(archivos)).toEqual(['a']);
    expect(perdidos).toEqual(['b']);
    expect(rutas.sort()).toEqual(['pendientes/u1/a', 'pendientes/u1/b']);
    expect(control.descartarSubidas).not.toHaveBeenCalled();
  });
});
