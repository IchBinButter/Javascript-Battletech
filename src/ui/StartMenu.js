/**
 * StartMenu - Full-screen start menu overlay.
 * Appears on launch with New Game, Load Game, Settings, Quit.
 * Follows the class-based DOM pattern of ForceBuilder/UIController.
 */

export class StartMenu {
  constructor(config = {}) {
    this.onNewGame = config.onNewGame || null;
    this.onLoadGame = config.onLoadGame || null;
    this.onSettings = config.onSettings || null;
    this.onQuit = config.onQuit || null;
    this.onCredits = config.onCredits || null;
    this.container = config.container || null;

    this._visible = false;
    this._menuItems = [];
    this._selectedIndex = 0;

    if (this.container) {
      this._buildUI();
    }
  }

  attach(container) {
    this.container = container;
    this._buildUI();
  }

  _buildUI() {
    if (!this.container) return;

    this.container.innerHTML = '';
    this.container.classList.add('sm-overlay');

    const overlay = document.createElement('div');
    overlay.className = 'sm-overlay-inner';

    const accentBar = document.createElement('div');
    accentBar.className = 'sm-accent-bar';

    const title = document.createElement('h1');
    title.className = 'sm-title';
    title.textContent = 'BATTLETECH';

    const subtitle = document.createElement('p');
    subtitle.className = 'sm-subtitle';
    subtitle.textContent = 'Tabletop Simulator';

    const menu = document.createElement('div');
    menu.className = 'sm-menu';
    this._menuEl = menu;

    this._buildMenuItems(menu);

    const version = document.createElement('p');
    version.className = 'sm-version';
    version.textContent = 'v1.0.0';

    overlay.appendChild(accentBar);
    overlay.appendChild(title);
    overlay.appendChild(subtitle);
    overlay.appendChild(menu);
    overlay.appendChild(version);
    this.container.appendChild(overlay);
    this._setupKeyboard();
  }

  _buildMenuItems(menuEl) {
    const items = [
      { id: 'new-game', label: 'New Game', action: 'onNewGame' },
      { id: 'load-game', label: 'Load Game', action: 'onLoadGame' },
      { id: 'settings', label: 'Settings', action: 'onSettings' },
      { id: 'quit', label: 'Quit', action: 'onQuit' }
    ];

    this._menuItems = [];

    for (let i = 0; i < items.length; i++) {
      const { id, label, action } = items[i];
      const btn = document.createElement('button');
      btn.className = 'sm-menu-item';
      btn.id = 'sm-' + id;
      btn.textContent = label;
      btn.tabIndex = 0;
      btn.dataset.action = action;
      btn.addEventListener('click', () => this._handleAction(action));
      btn.addEventListener('mouseenter', () => this._setSelectedIndex(i));
      this._menuItems.push(btn);
      menuEl.appendChild(btn);
    }
    this._setSelectedIndex(0);
  }

  _handleAction(action) {
    const cb = this[action];
    if (cb && typeof cb === 'function') cb();
  }

  _setSelectedIndex(index) {
    for (let i = 0; i < this._menuItems.length; i++) {
      this._menuItems[i].classList.toggle('sm-selected', i === index);
    }
    this._selectedIndex = index;
  }

  _activateSelected() {
    const item = this._menuItems[this._selectedIndex];
    if (item) this._handleAction(item.dataset.action);
  }

  _navigateSelection(direction) {
    const n = this._menuItems.length;
    const next = (this._selectedIndex + direction + n) % n;
    this._setSelectedIndex(next);
  }

  _setupKeyboard() {
    this._keyHandler = (e) => {
      if (!this._visible) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); this._navigateSelection(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this._navigateSelection(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); this._activateSelected(); }
    };
    document.addEventListener('keydown', this._keyHandler);
  }

  show() {
    if (!this.container) return;
    this.container.style.display = 'flex';
    this._visible = true;
    this._setSelectedIndex(0);
    if (this._menuItems.length > 0) this._menuItems[0].focus();
  }

  hide() {
    if (!this.container) return;
    this.container.style.display = 'none';
    this._visible = false;
  }

  isVisible() {
    return this._visible;
  }

  getMenuItems() {
    return this._menuItems.map(btn => btn.textContent);
  }

  getSelectedIndex() {
    return this._selectedIndex;
  }

  destroy() {
    if (this._keyHandler) {
      document.removeEventListener('keydown', this._keyHandler);
    }
    if (this.container) this.container.innerHTML = '';
  }

  reset() {
    this.destroy();
    this._selectedIndex = 0;
    this._visible = false;
    if (this.container) this._buildUI();
  }
}
