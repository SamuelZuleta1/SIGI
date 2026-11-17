// Días hábiles con los festivos de Colombia (DA-13), base del plazo de 3 días de HU-07 y de las alertas de HU-12.
import { describe, expect, it } from 'vitest';
import { diasHabilesRestantes, esDiaHabil, fechaLarga, FESTIVOS, sumarDiasHabiles } from '../../src/servicios/dias-habiles.js';

describe('DA-13 — días hábiles', () => {
  it('fines de semana y festivos no son hábiles', () => {
    expect(esDiaHabil('2026-11-17')).toBe(true); // martes
    expect(esDiaHabil('2026-11-21')).toBe(false); // sábado
    expect(esDiaHabil('2026-11-22')).toBe(false); // domingo
    expect(esDiaHabil('2026-11-16')).toBe(false); // Independencia de Cartagena (trasladado al lunes)
  });

  it('los festivos trasladables de la lista caen en lunes', () => {
    const trasladables = ['2026-01-12', '2026-03-23', '2026-05-18', '2026-06-08', '2026-06-15', '2026-08-17',
      '2026-11-02', '2026-11-16', '2027-01-11', '2027-03-22', '2027-05-10', '2027-05-31', '2027-06-07',
      '2027-07-05', '2027-08-16', '2027-10-18', '2027-11-15'];
    for (const fecha of trasladables) {
      expect(FESTIVOS.has(fecha)).toBe(true);
      expect(new Date(`${fecha}T00:00:00Z`).getUTCDay()).toBe(1);
    }
  });

  it('HU-07 — 3 días hábiles desde un martes sin festivos: el viernes', () => {
    expect(sumarDiasHabiles('2026-11-17', 3)).toBe('2026-11-20');
  });

  it('HU-07 — el plazo salta el fin de semana y el festivo', () => {
    // Jueves 12 → viernes 13, (sábado, domingo, lunes festivo 16), martes 17, miércoles 18.
    expect(sumarDiasHabiles('2026-11-12', 3)).toBe('2026-11-18');
    // Jueves 2 de abril de 2026 es Jueves Santo: viernes Santo y fin de semana no cuentan.
    expect(sumarDiasHabiles('2026-04-01', 3)).toBe('2026-04-08');
  });

  it('días hábiles que quedan: positivo, cero el día del límite y negativo si venció', () => {
    expect(diasHabilesRestantes('2026-11-17', '2026-11-20')).toBe(3);
    expect(diasHabilesRestantes('2026-11-20', '2026-11-20')).toBe(0);
    expect(diasHabilesRestantes('2026-11-24', '2026-11-20')).toBe(-2);
  });

  it('formato largo en español, sin coma después del día de la semana', () => {
    expect(fechaLarga('2026-11-20')).toBe('viernes 20 de noviembre de 2026');
  });
});
