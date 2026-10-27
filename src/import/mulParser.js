import { Unit } from '../models/Unit.js';
import { parseAndConvert } from './unitConverter.js';
import { getInternalStructure } from '../utils/helpers.js';

const COMMENT_REGEX = /<!--[\s\S]*?-->/g;

const UNIT_REGEX = /<Unit\b[^>]*>(?:(?!<Unit\b)[\s\S])*?<\/Unit>|<Unit\b[^>]*\/>/gi;

const ATTR_REGEX = /([\w-]+)\s*=\s*"([^"]*)"|([\w-]+)\s*=\s*'([^']*)'/g;

const LOCATIONS = [
  'head', 'centerTorso', 'leftTorso', 'rightTorso',
  'leftArm', 'rightArm', 'leftLeg', 'rightLeg'
];

function parseXMLAttributes(attrString) {
  const attrs = {};
  ATTR_REGEX.lastIndex = 0;
  let m;
  while ((m = ATTR_REGEX.exec(attrString)) !== null) {
    const key = m[1] || m[3];
    const val = m[2] || m[4];
    attrs[key] = val;
  }
  return attrs;
}

function extractPilot(body) {
  const pilotMatch = body.match(/<Pilot\b([^>]*?)(?:\/)?>/i);
  if (!pilotMatch) return null;

  const pAttrs = parseXMLAttributes(pilotMatch[1]);
  return {
    gunnery: parseInt(pAttrs.gunnery || '4', 10),
    piloting: parseInt(pAttrs.piloting || '5', 10)
  };
}

function extractEntity(body) {
  const entityMatch = body.match(/<Entity\b([^>]*?)(?:\/)?>/i);
  if (!entityMatch) return null;

  const eAttrs = parseXMLAttributes(entityMatch[1]);
  return {
    chassis: eAttrs.chassis || '',
    model: eAttrs.model || '',
    tonnage: parseInt(eAttrs.tonnage || eAttrs.tons || eAttrs.mass || '0', 10),
    mekId: eAttrs.mekId || eAttrs.mekid || eAttrs.mek_id || null
  };
}

export function parseMUL(xmlText) {
  const clean = xmlText.replace(COMMENT_REGEX, '');
  const units = [];

  let match;
  while ((match = UNIT_REGEX.exec(clean)) !== null) {
    const tagText = match[0];
    const isSelfClosing = tagText.endsWith('/>');

    const openTagMatch = tagText.match(/<Unit\b([^>]*?)(?:\/)?>/i);
    if (!openTagMatch) continue;

    const unitAttrs = parseXMLAttributes(openTagMatch[1]);

    let chassis = unitAttrs.chassis || '';
    let model = unitAttrs.model || '';
    let tonnage = parseInt(unitAttrs.tonnage || unitAttrs.tons || unitAttrs.mass || '0', 10);
    let mekId = unitAttrs.mekId || unitAttrs.mekid || unitAttrs.mek_id || null;

    let pilot = null;

    if (!isSelfClosing) {
      const body = tagText.slice(openTagMatch[0].length, -'</Unit>'.length);

      const entity = extractEntity(body);
      if (entity) {
        chassis = entity.chassis || chassis;
        model = entity.model || model;
        tonnage = entity.tonnage || tonnage;
        mekId = entity.mekId || mekId;
      }

      pilot = extractPilot(body);
    }

    units.push({ chassis, model, tonnage, pilot, mekId });
  }

  return units;
}

export function parseMULToUnits(xmlText, playerId, mechsData, mtfFiles = {}) {
  const entries = parseMUL(xmlText);
  const units = [];

  for (const entry of entries) {
    const unit = resolveUnit(entry, playerId, mechsData, mtfFiles);
    if (unit) {
      if (entry.pilot) {
        unit.pilot.gunnery = entry.pilot.gunnery;
        unit.pilot.piloting = entry.pilot.piloting;
      }
      units.push(unit);
    }
  }

  return units;
}

function resolveUnit(entry, playerId, mechsData, mtfFiles) {
  const rosterId = toMechId(entry.chassis, entry.model);
  const altRosterId = toMechId(entry.chassis, entry.model.replace(/-/g, ''));

  const mechs = mechsData?.mechs;
  const mechDef = mechs?.find(m => m.id === rosterId) || mechs?.find(m => m.id === altRosterId);
  if (mechDef) {
    return new Unit(mechDef, playerId);
  }

  if (entry.mekId && mtfFiles[entry.mekId]) {
    const def = parseAndConvert(mtfFiles[entry.mekId]);
    return new Unit(def, playerId);
  }

  const mtfName = `${entry.chassis} ${entry.model}.mtf`;
  if (mtfFiles[mtfName]) {
    const def = parseAndConvert(mtfFiles[mtfName]);
    return new Unit(def, playerId);
  }

  if (entry.tonnage > 0) {
    const def = buildStubMechDef(entry);
    return new Unit(def, playerId);
  }

  return null;
}

function toMechId(chassis, model) {
  const c = chassis.toLowerCase().replace(/\s+/g, '-');
  const m = model.toLowerCase().replace(/\s+/g, '-');
  return `${c}-${m}`;
}

function estimateWalkMP(tonnage) {
  if (tonnage <= 35) return 6;
  if (tonnage <= 55) return 5;
  if (tonnage <= 75) return 4;
  return 3;
}

function estimateEngineRating(tonnage, walkMP) {
  return tonnage * walkMP;
}

function buildStubMechDef(entry) {
  const id = toMechId(entry.chassis, entry.model);
  const name = `${entry.chassis} ${entry.model}`.trim();
  const tonnage = entry.tonnage;
  const walkMP = estimateWalkMP(tonnage);

  const armor = {};
  for (const loc of LOCATIONS) {
    armor[loc] = { front: 0, rear: 0 };
  }

  const criticalSlots = {};
  for (const loc of LOCATIONS) {
    criticalSlots[loc] = [];
  }

  return {
    id,
    name,
    tonnage,
    movement: { walk: walkMP, run: Math.floor(walkMP * 1.5), jump: 0 },
    armor,
    internalStructure: getInternalStructure(tonnage),
    criticalSlots,
    equipment: { weapons: [], ammo: {}, other: {} },
    heatSinks: { count: 10, type: 'single', damaged: 0 },
    engine: { type: 'standard', rating: estimateEngineRating(tonnage, walkMP), hits: 0 },
    gyro: { type: 'standard', hits: 0 }
  };
}
