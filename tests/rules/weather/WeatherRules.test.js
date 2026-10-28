/**
 * Weather conditions (BMM p62-63, Attack Modifiers Table p138).
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeWeather, attackModifier, physicalAttackModifier,
  movementModifier, psrModifier, heatPerTurn
} from '../../../src/rules/weather/WeatherRules.js';

const weapon = (type) => ({ type });

describe('weather defaults', () => {
  it('fills in a clear day', () => {
    expect(normalizeWeather()).toMatchObject({
      light: 'daylight', precipitation: 'none', fog: 'none', wind: 'none', temperature: 20
    });
  });
});

describe('attack modifiers', () => {
  it('heavy fog only affects pulse and direct-fire energy', () => {
    const weather = { fog: 'heavy' };
    expect(attackModifier(weather, 'DE').modifier).toBe(1);
    expect(attackModifier(weather, 'P').modifier).toBe(1);
    expect(attackModifier(weather, 'DB').modifier).toBe(0);
    expect(attackModifier(weather, 'LRM').modifier).toBe(0);
  });

  it('light fog has no attack modifier', () => {
    expect(attackModifier({ fog: 'light' }, 'DE').modifier).toBe(0);
  });

  it('dusk is +1 unless the target is at heat 25', () => {
    expect(attackModifier({ light: 'dusk' }, 'DE').modifier).toBe(1);
    expect(attackModifier({ light: 'dusk' }, 'DE', { heat: 25 }).modifier).toBe(0);
  });

  it('full moon night is +2, reduced by target heat', () => {
    expect(attackModifier({ light: 'full_moon' }, 'DE').modifier).toBe(2);
    expect(attackModifier({ light: 'full_moon' }, 'DE', { heat: 20 }).modifier).toBe(1);
    expect(attackModifier({ light: 'full_moon' }, 'DE', { heat: 40 }).modifier).toBe(0);
  });

  it('moonless night is +3, reduced by target heat', () => {
    expect(attackModifier({ light: 'moonless' }, 'DE').modifier).toBe(3);
    expect(attackModifier({ light: 'moonless' }, 'DE', { heat: 15 }).modifier).toBe(2);
    expect(attackModifier({ light: 'moonless' }, 'DE', { heat: 45 }).modifier).toBe(0);
  });

  it('rain and snow add their modifiers', () => {
    expect(attackModifier({ precipitation: 'rain' }, 'DE').modifier).toBe(1);
    expect(attackModifier({ precipitation: 'heavy_rain' }, 'DE').modifier).toBe(1);
    expect(attackModifier({ precipitation: 'torrential' }, 'DE').modifier).toBe(2);
    expect(attackModifier({ precipitation: 'snow' }, 'DE').modifier).toBe(1);
    expect(attackModifier({ precipitation: 'heavy_snow' }, 'DE').modifier).toBe(1);
  });

  it('wind punishes missiles and ballistics by gale strength', () => {
    expect(attackModifier({ wind: 'moderate' }, 'LRM').modifier).toBe(1);
    expect(attackModifier({ wind: 'moderate' }, 'DB').modifier).toBe(0);
    expect(attackModifier({ wind: 'strong' }, 'SRM').modifier).toBe(2);
    expect(attackModifier({ wind: 'strong' }, 'DB').modifier).toBe(1);
    expect(attackModifier({ wind: 'storm' }, 'LRM').modifier).toBe(3);
    expect(attackModifier({ wind: 'storm' }, 'DB').modifier).toBe(2);
    expect(attackModifier({ wind: 'storm' }, 'DE').modifier).toBe(0);
  });

  it('stacks conditions', () => {
    const weather = { fog: 'heavy', precipitation: 'torrential' };
    expect(attackModifier(weather, 'DE').modifier).toBe(3);
  });

  it('moonless night adds +1 to physical attacks', () => {
    expect(physicalAttackModifier({ light: 'moonless' }).modifier).toBe(1);
    expect(physicalAttackModifier({ light: 'daylight' }).modifier).toBe(0);
  });
});

describe('movement and piloting', () => {
  it('fog and darkness cost extra MP per hex', () => {
    expect(movementModifier({})).toBe(0);
    expect(movementModifier({ fog: 'light' })).toBe(1);
    expect(movementModifier({ fog: 'heavy' })).toBe(2);
    expect(movementModifier({ light: 'full_moon' })).toBe(1);
    expect(movementModifier({ light: 'moonless' })).toBe(2);
    expect(movementModifier({ fog: 'light', light: 'moonless' })).toBe(3);
  });

  it('heavy rain and torrential downpours penalise PSRs', () => {
    expect(psrModifier({})).toBe(0);
    expect(psrModifier({ precipitation: 'rain' })).toBe(0);
    expect(psrModifier({ precipitation: 'heavy_rain' })).toBe(1);
    expect(psrModifier({ precipitation: 'torrential' })).toBe(2);
  });

  it('extreme temperatures add or remove heat per turn', () => {
    expect(heatPerTurn({ temperature: 20 })).toBe(0);
    expect(heatPerTurn({ temperature: 50 })).toBe(0);
    expect(heatPerTurn({ temperature: 51 })).toBe(1);
    expect(heatPerTurn({ temperature: 70 })).toBe(2);
    expect(heatPerTurn({ temperature: -30 })).toBe(0);
    expect(heatPerTurn({ temperature: -31 })).toBe(-1);
    expect(heatPerTurn({ temperature: -50 })).toBe(-2);
  });
});
