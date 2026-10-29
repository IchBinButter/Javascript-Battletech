/**
 * HexRenderer - Low-level hex drawing utilities.
 * Provides pure drawing functions without game logic.
 */

import { getHexCorners, hexToPixel } from './HexMath.js';

/**
 * Trace the outline of one hex onto the current path. Shared by the filled,
 * outlined and overlay variants so all three cover exactly the same area.
 */
function traceHexPath(ctx, cx, cy, size) {
  const corners = getHexCorners(cx, cy, size);

  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < 6; i++) {
    ctx.lineTo(corners[i].x, corners[i].y);
  }
  ctx.closePath();
}

/**
 * Draw a single hex on a canvas context.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx - Center x pixel
 * @param {number} cy - Center y pixel
 * @param {number} size - Hex size (center to vertex)
 * @param {string} fillColor - Fill color
 * @param {string} strokeColor - Stroke color
 */
export function drawHex(ctx, cx, cy, size, fillColor, strokeColor = '#333333') {
  traceHexPath(ctx, cx, cy, size);

  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/**
 * Draw the full hex grid outline.
 */
export function drawHexGrid(ctx, grid, hexSize, offsetX = 0, offsetY = 0) {
  for (const hex of grid.getAllHexes()) {
    const { x, y } = hexToPixel(hex.hexKey, hexSize);
    drawHex(ctx, x + offsetX, y + offsetY, hexSize, 'transparent', '#444444');
  }
}

/**
 * Draw a direction arrow (facing indicator).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx - Center x
 * @param {number} cy - Center y
 * @param {number} size - Hex size
 * @param {number} facing - Facing 0-5
 * @param {string} color - Arrow color
 * @param {number} lineWidth - Shaft width
 */
export function drawFacingArrow(ctx, cx, cy, size, facing, color = '#ffffff', lineWidth = 2) {
  const angle = -Math.PI / 2 + (facing * Math.PI / 3);
  const arrowLength = size * 0.6;
  const tipX = cx + arrowLength * Math.cos(angle);
  const tipY = cy + arrowLength * Math.sin(angle);

  // Arrow head
  const headSize = size * 0.15;
  const leftAngle = angle + Math.PI * 0.75;
  const rightAngle = angle - Math.PI * 0.75;
  const leftX = tipX + headSize * Math.cos(leftAngle);
  const leftY = tipY + headSize * Math.sin(leftAngle);
  const rightX = tipX + headSize * Math.cos(rightAngle);
  const rightY = tipY + headSize * Math.sin(rightAngle);

  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(tipX, tipY);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(leftX, leftY);
  ctx.lineTo(rightX, rightY);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

/**
 * Draw text centered in a hex.
 */
export function drawHexText(ctx, cx, cy, text, color = '#ffffff', fontSize = 10) {
  ctx.fillStyle = color;
  ctx.font = `${fontSize}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy);
}

/**
 * Draw the outline of a hex without filling it.
 * Used for movement affordances, where a filled overlay would hide the terrain
 * but the reachable hex still has to read at a glance.
 */
export function drawHexOutline(ctx, cx, cy, size, color = '#ffffff', lineWidth = 2) {
  traceHexPath(ctx, cx, cy, size);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

/**
 * Draw a colored overlay on a hex (for movement preview, range bands, etc.).
 */
export function drawHexOverlay(ctx, cx, cy, size, color, alpha = 0.3) {
  traceHexPath(ctx, cx, cy, size);
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  ctx.fill();
  ctx.globalAlpha = 1;
}
