/**
 * Tiny DOM helpers for the record-sheet components.
 *
 * Plain DOM only - no framework and no dependencies. Everything here creates
 * elements through `document`/`createElementNS`, so the components work in the
 * browser and in jsdom without measuring layout.
 */

export const SVG_NS = 'http://www.w3.org/2000/svg';

/** Coerce a value to a non-negative integer, or 0. */
export function numberOrZero(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.floor(number);
}

function applyOptions(node, options = {}) {
  const {
    className = '',
    text = null,
    title = null,
    attrs = null,
    dataset = null,
    children = null
  } = options;

  if (className) {
    // SVGElement.className is a read-only SVGAnimatedString in jsdom, so SVG
    // nodes receive a plain class attribute.
    if (node.namespaceURI === SVG_NS) node.setAttribute('class', className);
    else node.className = className;
  }
  if (text !== null && text !== undefined) node.textContent = String(text);
  if (title !== null && title !== undefined) node.setAttribute('title', String(title));
  if (attrs) {
    for (const [name, value] of Object.entries(attrs)) {
      if (value === null || value === undefined || value === false) continue;
      node.setAttribute(name, value === true ? '' : String(value));
    }
  }
  if (dataset) {
    for (const [name, value] of Object.entries(dataset)) {
      if (value === null || value === undefined) continue;
      node.dataset[name] = String(value);
    }
  }
  appendChildren(node, children);
  return node;
}

/** Create an HTML element. */
export function el(tagName, options = {}) {
  return applyOptions(document.createElement(tagName), options);
}

/** Create an SVG element. */
export function svgEl(tagName, options = {}) {
  return applyOptions(document.createElementNS(SVG_NS, tagName), options);
}

/** Append a child, an array of children, or nothing. */
export function appendChildren(parent, children) {
  if (children === null || children === undefined) return parent;
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined) continue;
    parent.appendChild(child);
  }
  return parent;
}

/** A titled record-sheet section (`<section>` + heading). */
export function recordSection(title, className = '') {
  const section = el('section', {
    className: `record-section${className ? ` ${className}` : ''}`
  });
  if (title) {
    section.appendChild(el('h4', { className: 'record-title', text: title }));
  }
  return section;
}
