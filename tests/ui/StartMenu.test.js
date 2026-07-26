/** @vitest-environment jsdom */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StartMenu } from '../../src/ui/StartMenu.js';

function createDOMFixture() {
  document.body.innerHTML = '<div id="start-menu-overlay"></div>';
  return document.getElementById('start-menu-overlay');
}

describe('StartMenu', () => {
  let menu, container;

  beforeEach(() => {
    container = createDOMFixture();
    menu = new StartMenu({
      container,
      onNewGame: vi.fn(),
      onLoadGame: vi.fn(),
      onSettings: vi.fn(),
      onQuit: vi.fn()
    });
  });

  describe('layout rendering', () => {
    it('renders title BATTLETECH', () => {
      var t = container.querySelector('.sm-title');
      expect(t).not.toBeNull();
      expect(t.textContent).toBe('BATTLETECH');
    });
    it('renders subtitle', () => {
      var s = container.querySelector('.sm-subtitle');
      expect(s).not.toBeNull();
      expect(s.textContent).toBe('Tabletop Simulator');
    });
    it('renders 4 menu items', () => {
      expect(container.querySelectorAll('.sm-menu-item').length).toBe(4);
    });
    it('menu items have correct labels', () => {
      var items = container.querySelectorAll('.sm-menu-item');
      var labels = Array.from(items, el => el.textContent);
      expect(labels).toEqual(['New Game', 'Load Game', 'Settings', 'Quit']);
    });
    it('renders version v1.0.0', () => {
      expect(container.querySelector('.sm-version').textContent).toBe('v1.0.0');
    });
    it('renders accent bar', () => {
      expect(container.querySelector('.sm-accent-bar')).not.toBeNull();
    });
    it('first item selected', () => {
      var first = container.querySelector('.sm-menu-item');
      expect(first.classList.contains('sm-selected')).toBe(true);
    });
  });

  describe('show / hide / isVisible', () => {
    it('show displays menu', () => {
      menu.show();
      expect(container.style.display).toBe('flex');
      expect(menu.isVisible()).toBe(true);
    });
    it('hide conceals menu', () => {
      menu.show(); menu.hide();
      expect(container.style.display).toBe('none');
      expect(menu.isVisible()).toBe(false);
    });
    it('starts hidden', () => {
      expect(menu.isVisible()).toBe(false);
    });
    it('show resets selection', () => {
      menu._setSelectedIndex(2); menu.show();
      expect(menu.getSelectedIndex()).toBe(0);
    });
  });

  describe('menu callbacks', () => {
    it('New Game calls onNewGame', () => {
      container.querySelector('#sm-new-game').click();
      expect(menu.onNewGame).toHaveBeenCalledTimes(1);
    });
    it('Load Game calls onLoadGame', () => {
      container.querySelector('#sm-load-game').click();
      expect(menu.onLoadGame).toHaveBeenCalledTimes(1);
    });
    it('Settings calls onSettings', () => {
      container.querySelector('#sm-settings').click();
      expect(menu.onSettings).toHaveBeenCalledTimes(1);
    });
    it('Quit calls onQuit', () => {
      container.querySelector('#sm-quit').click();
      expect(menu.onQuit).toHaveBeenCalledTimes(1);
    });
    it('no crash on missing callback', () => {
      var sm2 = new StartMenu({ container });
      expect(() => container.querySelector('#sm-new-game').click()).not.toThrow();
    });
  });

  describe('keyboard navigation', () => {
    it('ArrowDown moves to next item', () => {
      menu.show();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      expect(menu.getSelectedIndex()).toBe(1);
    });
    it('ArrowUp moves to previous', () => {
      menu.show(); menu._setSelectedIndex(2);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      expect(menu.getSelectedIndex()).toBe(1);
    });
    it('ArrowDown wraps last to first', () => {
      menu.show(); menu._setSelectedIndex(3);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      expect(menu.getSelectedIndex()).toBe(0);
    });
    it('ArrowUp wraps first to last', () => {
      menu.show();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      expect(menu.getSelectedIndex()).toBe(3);
    });
    it('Enter activates selected', () => {
      menu.show();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(menu.onNewGame).toHaveBeenCalledTimes(1);
    });
    it('no keyboard when hidden', () => {
      menu._setSelectedIndex(0);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      expect(menu.getSelectedIndex()).toBe(0);
    });
  });

  describe('mouse hover', () => {
    it('mouse enter selects', () => {
      var items = container.querySelectorAll('.sm-menu-item');
      items[2].dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      expect(menu.getSelectedIndex()).toBe(2);
    });
  });

  describe('getMenuItems', () => {
    it('returns all labels', () => {
      expect(menu.getMenuItems()).toEqual(['New Game', 'Load Game', 'Settings', 'Quit']);
    });
  });

  describe('getSelectedIndex', () => {
    it('returns 0 by default', () => {
      expect(menu.getSelectedIndex()).toBe(0);
    });
    it('tracks selection changes', () => {
      menu._setSelectedIndex(3);
      expect(menu.getSelectedIndex()).toBe(3);
    });
  });

  describe('attach', () => {
    it('builds UI via attach', () => {
      var div = document.createElement('div');
      var sm = new StartMenu({ onNewGame: vi.fn() });
      sm.attach(div);
      expect(div.querySelector('.sm-title')).not.toBeNull();
    });
  });

  describe('destroy', () => {
    it('clears container HTML', () => {
      menu.destroy();
      expect(container.innerHTML).toBe('');
    });
    it('removes key listener', () => {
      menu.show(); menu.destroy();
      var evt = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true });
      expect(() => document.dispatchEvent(evt)).not.toThrow();
    });
  });

  describe('reset', () => {
    it('rebuilds UI on reset', () => {
      menu.reset();
      expect(container.querySelector('.sm-title')).not.toBeNull();
      expect(container.querySelectorAll('.sm-menu-item').length).toBe(4);
    });
    it('resets to hidden', () => {
      menu.show(); menu.reset();
      expect(menu.isVisible()).toBe(false);
      expect(menu.getSelectedIndex()).toBe(0);
    });
  });

  describe('optional callbacks', () => {
    it('operates safely without callbacks', () => {
      var div = document.createElement('div');
      var sm = new StartMenu({ container: div });
      expect(div.querySelector('.sm-title')).not.toBeNull();
      expect(() => div.querySelector('#sm-quit').click()).not.toThrow();
    });
  });

});
