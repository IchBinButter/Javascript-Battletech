/**
 * MapRenderer - Canvas-based hex map renderer.
 * Handles terrain, grid, overlays, and unit rendering.
 */

import { hexToPixel, getHexCorners } from '../hex/HexMath.js';
import { drawHex, drawHexGrid, drawFacingArrow, drawHexText, drawHexOverlay } from '../hex/HexRenderer.js';

const TERRAIN_COLORS = {
  clear: '#90EE90',
  light_woods: '#228B22',
  heavy_woods: '#006400',
  water_depth1: '#4169E1',
  water_depth2: '#0000CD',
  rough: '#8B7355',
  rubble: '#808080',
  swamp: '#556B2F',
  pavement: '#D2B48C',
  bridge: '#A0522D',
  light_building: '#C9B79C',
  medium_building: '#A89B8C',
  heavy_building: '#8A8078',
  hardened_building: '#6F6A66'
};

const PLAYER_COLORS = ['#3b82f6', '#ef4444'];

export class MapRenderer {
  constructor(canvas, hexSize = 30) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hexSize = hexSize;
    this.offsetX = 0;
    this.offsetY = 0;
    this.showGrid = true;
    this.showElevation = true;

    // Preview data
    this.validMoves = null;
    this.hoveredHex = null;
    this.selectedUnit = null;
    this.losPreview = null;

    // Render batching
    this._pendingRender = null;
    this._latestState = null;
  }

  /**
   * Schedule a render. Multiple calls in the same frame are coalesced
   * into a single requestAnimationFrame render.
   */
  render(gameState) {
    this._latestState = gameState;
    if (this._pendingRender === null) {
      this._pendingRender = requestAnimationFrame(() => {
        this._pendingRender = null;
        this._doRender(this._latestState);
      });
    }
  }

  /**
   * Full render pass: terrain → grid → overlays → units
   */
  _doRender(gameState) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (!gameState || !gameState.map || !gameState.map.hexes) return;

    const hexes = gameState.map.hexes;

    // 1. Draw terrain
    for (const [, hex] of hexes) {
      const { x, y } = hexToPixel(hex.hexKey, this.hexSize);
      const drawX = x + this.offsetX;
      const drawY = y + this.offsetY;

      if (!this._isVisible(drawX, drawY)) continue;

      const color = TERRAIN_COLORS[hex.terrainType] || TERRAIN_COLORS.clear;
      drawHex(ctx, drawX, drawY, this.hexSize, color, '#555555');

      // Draw elevation
      if (this.showElevation && hex.level > 0) {
        drawHexText(ctx, drawX - this.hexSize * 0.4, drawY - this.hexSize * 0.3,
          `${hex.level}`, '#000000', 9);
      }

      // Draw building
      if (hex.building) {
        this._drawBuilding(ctx, drawX, drawY, hex);
      }

      // Draw terrain-specific icons
      this._drawTerrainDetails(ctx, drawX, drawY, hex);
    }

    // 2. Draw movement preview overlay
    if (this.validMoves) {
      this.drawMovementPreview(this.validMoves);
    }

    // 3. Draw LOS preview
    if (this.losPreview) {
      this.drawLOSPreview(this.losPreview);
    }

    // 4. Draw grid lines
    if (this.showGrid) {
      drawHexGrid(ctx, { getAllHexes: () => Array.from(hexes.values()) },
        this.hexSize, this.offsetX, this.offsetY);
    }

    // 5. Draw units
    this._drawUnitTokens(gameState);

    // 6. Draw fire/smoke overlays
    this.drawOverlays(gameState);
  }

  /**
   * Draw a token for every unit in the view the renderer was handed.
   *
   * The state passed to the renderer is already projected for the viewing
   * player (see projectStateForPlayer), so this must never reach back into the
   * engine's raw state: a unit that is absent from `gameState.units` is a unit
   * this player cannot see, and drawing it would leak a hidden unit's position.
   * Reading `hiddenUnits` here instead would be wrong in the other direction -
   * it would also hide the viewer's own hidden units.
   */
  _drawUnitTokens(gameState) {
    if (!gameState.units) return;

    for (const [id, unit] of Object.entries(gameState.units)) {
      if (!unit || !unit.position || !unit.position.hexKey) continue;
      const { x, y } = hexToPixel(unit.position.hexKey, this.hexSize);
      this.drawUnit(unit, x + this.offsetX, y + this.offsetY, id);
    }
  }

  /**
   * Draw a single unit token.
   */
  drawUnit(unit, cx, cy, unitId) {
    const ctx = this.ctx;
    const size = this.hexSize * 0.5;
    const playerColor = PLAYER_COLORS[unit.player] || '#888888';
    const isSelected = this.selectedUnit === unitId;

    // Token circle
    ctx.beginPath();
    ctx.arc(cx, cy, size, 0, Math.PI * 2);
    ctx.fillStyle = unit.shutdown ? '#444444' : playerColor;
    ctx.fill();
    ctx.strokeStyle = isSelected ? '#ffff00' : '#ffffff';
    ctx.lineWidth = isSelected ? 3 : 1;
    ctx.stroke();

    // Name abbreviation
    const abbrev = unit.name.substring(0, 3).toUpperCase();
    drawHexText(ctx, cx, cy - 5, abbrev, '#ffffff', 10);

    // Heat indicator
    const heatColor = unit.heat < 5 ? '#4ade80' :
      unit.heat < 10 ? '#facc15' :
      unit.heat < 15 ? '#f97316' :
      unit.heat < 20 ? '#ef4444' : '#ff0000';
    drawHexText(ctx, cx, cy + 8, `H:${unit.heat}`, heatColor, 8);

    // Facing arrow
    drawFacingArrow(ctx, cx, cy, size * 0.75, unit.position.facing, '#ffffff');

    // Status indicators
    if (unit.prone) {
      drawHexText(ctx, cx, cy + size + 8, 'PRONE', '#ff4444', 8);
    }
    if (unit.shutdown) {
      drawHexText(ctx, cx, cy - size - 8, 'DOWN', '#ff4444', 8);
    }
  }

  /**
   * Draw movement preview overlays.
   */
  drawMovementPreview(validMoves) {
    const ctx = this.ctx;

    for (const [key, data] of validMoves) {
      // Skip the hexKey@facing variants (stay-and-turn moves)
      if (key.includes('@')) continue;

      const { x, y } = hexToPixel(key, this.hexSize);
      const drawX = x + this.offsetX;
      const drawY = y + this.offsetY;

      if (!this._isVisible(drawX, drawY)) continue;

      // Color by remaining MP percentage
      const pct = data.remainingMP !== undefined ?
        Math.min(1, data.remainingMP / 10) : 0.3;
      const color = `rgba(59, 130, 246, ${0.15 + pct * 0.1})`;

      drawHexOverlay(ctx, drawX, drawY, this.hexSize, color, 0.3);
    }
  }

  /**
   * Draw LOS preview line.
   */
  drawLOSPreview(losData) {
    const ctx = this.ctx;
    const { fromKey, toKey, losResult } = losData;

    const fromPos = hexToPixel(fromKey, this.hexSize);
    const toPos = hexToPixel(toKey, this.hexSize);

    ctx.beginPath();
    ctx.moveTo(fromPos.x + this.offsetX, fromPos.y + this.offsetY);
    ctx.lineTo(toPos.x + this.offsetX, toPos.y + this.offsetY);
    ctx.strokeStyle = losResult.blocked ? '#ff0000' : '#00ff00';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Mark intervening hexes
    for (const ikey of losResult.interveningHexes) {
      const pos = hexToPixel(ikey, this.hexSize);
      drawHexOverlay(ctx, pos.x + this.offsetX, pos.y + this.offsetY, this.hexSize,
        'rgba(255, 255, 0, 0.2)', 0.2);
    }
  }

  /**
   * Draw fire and smoke overlays.
   */
  drawOverlays(gameState) {
    const ctx = this.ctx;

    // Fire hexes
    if (gameState.fireHexes) {
      for (const key of gameState.fireHexes) {
        const { x, y } = hexToPixel(key, this.hexSize);
        drawHexOverlay(ctx, x + this.offsetX, y + this.offsetY, this.hexSize,
          'rgba(255, 69, 0, 0.4)', 0.4);
      }
    }

    // Smoke hexes
    if (gameState.smokeHexes) {
      for (const key of Object.keys(gameState.smokeHexes)) {
        const { x, y } = hexToPixel(key, this.hexSize);
        drawHexOverlay(ctx, x + this.offsetX, y + this.offsetY, this.hexSize,
          'rgba(128, 128, 128, 0.3)', 0.3);
      }
    }
  }

  /**
   * Draw terrain-specific details (trees, water ripples).
   */
  _drawTerrainDetails(ctx, cx, cy, hex) {
    const s = this.hexSize * 0.3;

    switch (hex.terrainType) {
      case 'light_woods':
        this._drawTree(ctx, cx - s, cy, s * 0.5);
        this._drawTree(ctx, cx + s * 0.5, cy - s * 0.5, s * 0.4);
        break;
      case 'heavy_woods':
        this._drawTree(ctx, cx - s, cy, s * 0.6);
        this._drawTree(ctx, cx + s * 0.5, cy - s * 0.5, s * 0.5);
        this._drawTree(ctx, cx, cy + s * 0.3, s * 0.4);
        break;
      case 'water_depth1':
      case 'water_depth2':
        this._drawWaterRipples(ctx, cx, cy);
        break;
      case 'rough':
        this._drawRocks(ctx, cx, cy);
        break;
    }
  }

  _drawTree(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 100, 0, 0.6)';
    ctx.fill();
    ctx.fillStyle = 'rgba(139, 69, 19, 0.4)';
    ctx.fillRect(x - 1, y, 2, r);
  }

  _drawWaterRipples(ctx, cx, cy) {
    ctx.beginPath();
    ctx.arc(cx, cy, this.hexSize * 0.15, 0, Math.PI);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  _drawRocks(ctx, cx, cy) {
    ctx.beginPath();
    ctx.arc(cx + 4, cy - 2, 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(120, 100, 80, 0.5)';
    ctx.fill();
  }

  _drawBuilding(ctx, cx, cy, hex) {
    const s = this.hexSize * 0.35;
    const building = hex.building;
    const cf = building.currentCF ?? building.cf;
    const destroyed = typeof cf === 'number' && cf <= 0;

    ctx.fillStyle = destroyed ? '#6B6B6B' : '#8C8C8C';
    ctx.fillRect(cx - s, cy - s, s * 2, s * 2);
    ctx.strokeStyle = destroyed ? '#3F3F3F' : '#444444';
    ctx.lineWidth = 2;
    ctx.strokeRect(cx - s, cy - s, s * 2, s * 2);

    // Level and remaining CF, so a damaged structure is visible on the map.
    drawHexText(ctx, cx, cy, destroyed ? 'RUBBLE' : `L${building.levels}·${cf}`, '#ffffff', 8);
  }

  _isVisible(x, y) {
    return x + this.hexSize > 0 && x - this.hexSize < this.canvas.width &&
      y + this.hexSize > 0 && y - this.hexSize < this.canvas.height;
  }
}
