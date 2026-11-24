import { describe, expect, it } from 'vitest';
import { configurarAccesoRapido } from '../../src/config/acceso-rapido.js';
import { ROLES } from '../../src/models/usuario.model.js';

describe('configurarAccesoRapido', () => {
  it('también funciona en producción si hay DEMO_PASSWORD', () => {
    expect(configurarAccesoRapido({ NODE_ENV: 'production', DEMO_PASSWORD: 'Clave-larga-1' })).not.toBeNull();
  });

  it('sin DEMO_PASSWORD no existe', () => {
    expect(configurarAccesoRapido({})).toBeNull();
  });

  it('un usuario de demostración por rol, auxiliar primero', () => {
    const acceso = configurarAccesoRapido({ DEMO_PASSWORD: 'Clave-larga-1' });
    expect(acceso.contrasena).toBe('Clave-larga-1');
    expect(Object.keys(acceso.correos)[0]).toBe('auxiliar');
    expect(Object.keys(acceso.correos).sort()).toEqual([...ROLES].sort());
    expect(acceso.correos.cartera).toBe('cartera1@sigi.test');
  });
});
