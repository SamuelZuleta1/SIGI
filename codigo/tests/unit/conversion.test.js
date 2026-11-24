import { describe, expect, it } from 'vitest';
import { aCamel, aFila, aSnake, desdeFila } from '../../src/persistence/conversion.js';
import { Incapacidad } from '../../src/models/incapacidad.model.js';

describe('T-00b — conversión de nombres diseño ↔ base de datos (P-E)', () => {
  it('todos los atributos de Incapacidad van y vuelven sin cambiar', () => {
    for (const atributo of Object.keys(new Incapacidad())) {
      expect(aCamel(aSnake(atributo))).toBe(atributo);
    }
  });

  it('convierte los nombres con siglas', () => {
    expect(aSnake('valorEPS')).toBe('valor_eps');
    expect(aCamel('valor_eps')).toBe('valorEPS');
    expect(aSnake('enviadaAGestionDocumental')).toBe('enviada_a_gestion_documental');
  });

  it('aFila aplica renombres y omite los undefined', () => {
    expect(aFila({ idIncapacidad: 7, diasIncapacidad: 3, estado: null, tipo: undefined }, { idIncapacidad: 'id' }))
      .toEqual({ id: 7, dias_incapacidad: 3, estado: null });
  });

  it('desdeFila aplica renombres y admite null', () => {
    expect(desdeFila({ id: 7, fecha_inicio: '2026-11-03' }, { id: 'idIncapacidad' }))
      .toEqual({ idIncapacidad: 7, fechaInicio: '2026-11-03' });
    expect(desdeFila(null)).toBeNull();
  });
});
