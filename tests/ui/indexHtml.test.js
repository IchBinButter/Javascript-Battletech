/**
 * @vitest-environment jsdom
 *
 * Structural checks on index.html: everything the UI drives must exist, with
 * the right labels, before a single line of script runs.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const doc = new DOMParser().parseFromString(html, 'text/html');

const REQUIRED_IDS = [
  // layout
  'app', 'map-container', 'map-canvas', 'ui-panel', 'start-menu-overlay',
  // indicators
  'phase-bar', 'phase-label', 'turn-label', 'active-player',
  // panels
  'unit-panel', 'unit-details', 'action-panel', 'action-buttons',
  'weapon-panel', 'weapon-list', 'btn-fire',
  'physical-panel', 'physical-type', 'btn-physical',
  'movement-panel', 'movement-mode', 'mp-display',
  'btn-confirm-move', 'btn-cancel-move',
  // log
  'log-panel', 'dice-log'
];

describe('index.html structure', () => {
  it('has every element the UI drives', () => {
    for (const id of REQUIRED_IDS) {
      expect(doc.getElementById(id), `#${id} missing`).not.toBeNull();
    }
  });

  it('has both action buttons with their labels', () => {
    expect(doc.getElementById('btn-fire').textContent.trim()).toBe('Fire Selected');
    expect(doc.getElementById('btn-physical').textContent.trim()).toBe('Execute Attack');
    expect(doc.getElementById('btn-confirm-move').textContent.trim()).toBe('Confirm Move');
    expect(doc.getElementById('btn-cancel-move').textContent.trim()).toBe('Cancel');
  });

  it('offers the three movement modes with walk selected', () => {
    const modes = [...doc.querySelectorAll('input[name="moveMode"]')];
    expect(modes.map(m => m.value)).toEqual(['walk', 'run', 'jump']);
    expect(modes.find(m => m.checked).value).toBe('walk');
  });

  it('offers every physical attack type', () => {
    const options = [...doc.querySelectorAll('#physical-type option')].map(o => o.value);
    expect(options).toEqual(['punch', 'kick', 'charge', 'dfa', 'push']);
  });

  it('starts with the game panels hidden and the canvas present', () => {
    expect(doc.getElementById('map-canvas').tagName).toBe('CANVAS');
    expect(doc.getElementById('weapon-panel').style.display).toBe('none');
    expect(doc.getElementById('physical-panel').style.display).toBe('none');
    expect(doc.getElementById('movement-panel').style.display).toBe('none');
    expect(doc.getElementById('start-menu-overlay').style.display).toBe('none');
  });

  it('loads the module entry point and the stylesheet', () => {
    const script = doc.querySelector('script[type="module"]');
    expect(script).not.toBeNull();
    expect(script.getAttribute('src')).toBe('src/main.js');
    expect(doc.querySelector('link[rel="stylesheet"]').getAttribute('href')).toBe('styles.css');
  });

  it('every element id read by the source exists in the page', () => {
    // Ids the code creates at runtime are not expected in the static HTML.
    const createdAtRuntime = new Set(['force-builder-container']);
    const referenced = new Set();

    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(full); continue; }
        if (!entry.name.endsWith('.js')) continue;

        const source = fs.readFileSync(full, 'utf8');
        for (const match of source.matchAll(/getElementById\(\s*['"]([\w-]+)['"]\s*\)/g)) {
          referenced.add(match[1]);
        }
        for (const match of source.matchAll(/querySelector\(\s*['"]#([\w-]+)['"]\s*\)/g)) {
          referenced.add(match[1]);
        }
        for (const match of source.matchAll(/\bid\s*=\s*`?([\w-]+)`?/g)) {
          if (/\b(fb-|sm-)/.test(match[1])) referenced.add(match[1]);
        }
      }
    };
    walk(path.join(root, 'src'));

    // Ids assigned by JavaScript (dynamically built panels) are checked by use.
    const builtByScript = (id) => /^(fb-|sm-)/.test(id) || createdAtRuntime.has(id);

    const missing = [...referenced]
      .filter(id => !builtByScript(id))
      .filter(id => doc.getElementById(id) === null);

    expect(missing, `ids referenced but not in index.html: ${missing.join(', ')}`).toEqual([]);
  });
});
