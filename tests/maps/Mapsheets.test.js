import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const mapsDir = resolve(__dirname, '..', '..', 'src', 'data', 'maps');

const VALID_TERRAIN = new Set([
  'clear', 'light_woods', 'heavy_woods',
  'water_depth1', 'water_depth2',
  'rough', 'swamp', 'pavement', 'bridge', 'light_building', 'medium_building', 'heavy_building'
]);

function loadMap(filename) {
  const raw = readFileSync(resolve(mapsDir, filename), 'utf-8');
  return JSON.parse(raw);
}

describe('Mapsheets', () => {
  const index = JSON.parse(readFileSync(resolve(mapsDir, 'index.json'), 'utf-8'));
  const entries = index.maps;

  it('index.json has exactly 6 map entries', () => {
    expect(entries).toHaveLength(6);
  });

  describe.each(entries)('$name ($id)', ({ id, name, file, description }) => {
    const map = loadMap(file);

    it('has correct metadata', () => {
      expect(map.id).toBe(id);
      expect(map.name).toBe(name);
      expect(map.description).toBe(description);
      expect(map.width).toBe(17);
      expect(map.height).toBe(15);
    });

    it('has exactly 255 hexes (17 x 15)', () => {
      expect(Object.keys(map.hexes)).toHaveLength(255);
    });

    it('all hex keys are valid "col,row" within bounds', () => {
      for (const key of Object.keys(map.hexes)) {
        expect(key).toMatch(/^\d+,\d+$/);
        const [col, row] = key.split(',').map(Number);
        expect(col).toBeGreaterThanOrEqual(0);
        expect(col).toBeLessThan(17);
        expect(row).toBeGreaterThanOrEqual(0);
        expect(row).toBeLessThan(15);
      }
    });

    it('every hex has a valid terrain type', () => {
      for (const key of Object.keys(map.hexes)) {
        const hex = map.hexes[key];
        expect(hex).toHaveProperty('terrain');
        expect(VALID_TERRAIN.has(hex.terrain)).toBe(true);
      }
    });

    it('every hex has an integer level', () => {
      for (const key of Object.keys(map.hexes)) {
        const hex = map.hexes[key];
        expect(hex).toHaveProperty('level');
        expect(Number.isInteger(hex.level)).toBe(true);
        expect(hex.level).toBeGreaterThanOrEqual(0);
      }
    });

    it('has no duplicate hex keys', () => {
      const keys = Object.keys(map.hexes);
      expect(new Set(keys).size).toBe(keys.length);
    });
  });

  it('index maps array matches directory json files', () => {
    const jsonFiles = readdirSync(mapsDir)
      .filter(f => f.endsWith('.json') && f !== 'index.json')
      .sort();
    const indexFiles = entries.map(e => e.file).sort();
    expect(indexFiles).toEqual(jsonFiles);
  });
});
