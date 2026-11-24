// DA-51 — el IBC se compara con el SMMLV del año de inicio: advierte, no bloquea.
import { describe, expect, it } from 'vitest';
import { advertenciaIbc, smmlvDe } from '../../src/servicios/smmlv.js';

describe('smmlvDe', () => {
  it('da el del año pedido', () => expect(smmlvDe(2026)).toEqual({ anio: 2026, valor: 1_750_905 }));
  it('un año sin valor usa el más cercano anterior y dice cuál', () => expect(smmlvDe(2027)).toEqual({ anio: 2026, valor: 1_750_905 }));
  it('un año anterior a la lista usa el primero', () => expect(smmlvDe(2020).anio).toBe(2025));
});

describe('advertenciaIbc', () => {
  const centavos = (pesos) => pesos * 100;
  it.each([
    [1_750_904, 'bajo'],
    [1_750_905, null],
    [43_772_625, null], // 25 SMMLV exactos
    [43_772_626, 'alto'],
  ])('IBC de %i en 2026: %s', (ibc, tipo) => {
    expect(advertenciaIbc(centavos(ibc), '2026-03-01')?.tipo ?? null).toBe(tipo);
  });

  it('usa el año de inicio de la incapacidad', () => {
    expect(advertenciaIbc(centavos(1_500_000), '2025-12-31')).toBeNull();
    expect(advertenciaIbc(centavos(1_500_000), '2026-01-01')).toMatchObject({ tipo: 'bajo', anio: 2026, limite: 1_750_905 });
  });
});
