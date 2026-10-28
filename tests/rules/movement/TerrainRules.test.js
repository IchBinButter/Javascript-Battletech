/**
 * Terrain modifications (BMM p61, Movement Costs Table p136):
 * ice +1 MP / PSR +3, mud +1/+1, deep snow +1/+1, swamp +1/+1.
 */

import { describe, it, expect } from 'vitest';
import { Hex } from '../../../src/models/Hex.js';
import { terrainModifiersForHex, terrainPSRModifier, requiresTerrainPSR } from '../../../src/rules/movement/TerrainRules.js';

const hexWith = (data) => new Hex('1,1', data);

describe('terrain modifiers', () => {
  it('reads the flags from a hex', () => {
    const hex = hexWith({ ice: true, mud: true, deepSnow: true });
    expect(terrainModifiersForHex(hex)).toEqual({ ice: true, mud: true, deepSnow: true, swamp: false });
  });

  it('treats swamp as a terrain type', () => {
    expect(terrainModifiersForHex(hexWith({ terrainType: 'swamp' })).swamp).toBe(true);
  });

  it('gives ice a +3 PSR modifier', () => {
    expect(terrainPSRModifier(hexWith({ ice: true })).modifier).toBe(3);
  });

  it('gives mud and deep snow +1 each', () => {
    expect(terrainPSRModifier(hexWith({ mud: true })).modifier).toBe(1);
    expect(terrainPSRModifier(hexWith({ deepSnow: true })).modifier).toBe(1);
  });

  it('gives swamp +1', () => {
    expect(terrainPSRModifier(hexWith({ terrainType: 'swamp' })).modifier).toBe(1);
  });

  it('adds the modifiers when several apply', () => {
    expect(terrainPSRModifier(hexWith({ ice: true, mud: true })).modifier).toBe(4);
  });

  it('does nothing on clear ground', () => {
    const result = terrainPSRModifier(hexWith({}));
    expect(result.modifier).toBe(0);
    expect(result.reasons).toEqual([]);
    expect(requiresTerrainPSR(hexWith({}))).toBe(false);
  });
});
