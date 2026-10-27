import { parseMTF } from './mtfParser.js';
import { getInternalStructure } from '../utils/helpers.js';

const ammoShotsPerTon = {
  ac2: 45, ac5: 20, ac10: 10, ac20: 5,
  srm2: 50, srm4: 25, srm6: 15,
  lrm5: 24, lrm10: 12, lrm15: 8, lrm20: 6,
  machinegun: 200,
  flamer: 20
};

const EQUIPMENT_NAME_MAP = {
  'heat sink': 'heat_sink',
  'double heat sink': 'heat_sink',
  'isdouble heat sink': 'heat_sink',
  'cl double heat sink': 'heat_sink',
  'jump jet': 'jump_jet',
  'life support': 'life_support',
  'sensors': 'sensors',
  'cockpit': 'cockpit',
  'engine': 'engine',
  'gyro': 'gyro',
  'shoulder': 'shoulder',
  'upper arm': 'upper_arm_actuator',
  'lower arm': 'lower_arm_actuator',
  'hand actuator': 'hand_actuator',
  'hand': 'hand_actuator',
  'hip': 'hip',
  'upper leg': 'upper_leg_actuator',
  'lower leg': 'lower_leg_actuator',
  'foot actuator': 'foot_actuator',
  'foot': 'foot_actuator',
  'case': 'case',
  'endo steel': 'endo_steel',
  'ferro-fibrous': 'ferro_fibrous',
  'ferro fibrous': 'ferro_fibrous',
  'targeting computer': 'targeting_computer',
  'masc': 'masc',
  'tsm': 'tsm',
  'ecm suite': 'ecm',
  'guardian ecm suite': 'ecm',
  'artemis iv fcs': 'artemis_iv',
  'artemis iv': 'artemis_iv',
  'c3 slave': 'c3_slave',
  'c3 master': 'c3_master',
  'c3i': 'c3i',
  'tag': 'tag',
  'narc': 'narc',
  'ams': 'ams',
  'ap pod': 'a_pod',
  'bap': 'beagle_active_probe',
  'active probe': 'beagle_active_probe',
  'medium shield': 'medium_shield',
  'large shield': 'large_shield'
};

const WEAPON_NAME_MAP = {
  'medium laser': 'med_laser',
  'medium laser (r)': 'med_laser_rear',
  'medium pulse laser': 'med_pulse_laser',
  'er medium laser': 'er_med_laser',
  'large laser': 'large_laser',
  'large laser (r)': 'large_laser_rear',
  'large pulse laser': 'large_pulse_laser',
  'er large laser': 'er_large_laser',
  'small laser': 'small_laser',
  'small pulse laser': 'small_pulse_laser',
  'er small laser': 'er_small_laser',
  'ppc': 'ppc',
  'er ppc': 'er_ppc',
  'light ppc': 'light_ppc',
  'heavy ppc': 'heavy_ppc',
  'snub-nose ppc': 'snub_nose_ppc',
  'ac/2': 'ac2',
  'ac/5': 'ac5',
  'ac/10': 'ac10',
  'ac/20': 'ac20',
  'ultra ac/2': 'uac2',
  'ultra ac/5': 'uac5',
  'ultra ac/10': 'uac10',
  'ultra ac/20': 'uac20',
  'lb 2-x ac': 'lbx2',
  'lb 5-x ac': 'lbx5',
  'lb 10-x ac': 'lbx10',
  'lb 20-x ac': 'lbx20',
  'rotary ac/2': 'rac2',
  'rotary ac/5': 'rac5',
  'gauss rifle': 'gauss_rifle',
  'light gauss rifle': 'light_gauss',
  'heavy gauss rifle': 'heavy_gauss',
  'srm 2': 'srm2',
  'srm 4': 'srm4',
  'srm 6': 'srm6',
  'streak srm 2': 'streak_srm2',
  'streak srm 4': 'streak_srm4',
  'streak srm 6': 'streak_srm6',
  'lrm 5': 'lrm5',
  'lrm 10': 'lrm10',
  'lrm 15': 'lrm15',
  'lrm 20': 'lrm20',
  'mrm 10': 'mrm10',
  'mrm 20': 'mrm20',
  'mrm 30': 'mrm30',
  'mrm 40': 'mrm40',
  'rocket launcher 10': 'rl10',
  'rocket launcher 15': 'rl15',
  'rocket launcher 20': 'rl20',
  'machine gun': 'machinegun',
  'light machine gun': 'light_machinegun',
  'heavy machine gun': 'heavy_machinegun',
  'flamer': 'flamer',
  'heavy flamer': 'heavy_flamer',
  'er flamer': 'er_flamer',
  'small x-pulse laser': 'small_xpulse',
  'medium x-pulse laser': 'medium_xpulse',
  'large x-pulse laser': 'large_xpulse',
  'plasma rifle': 'plasma_rifle',
  'plasma cannon': 'plasma_cannon'
};

const AMMO_NAME_MAP = {
  'ac/2 ammo': { id: 'ac2_ammo', type: 'ac2' },
  'ac/5 ammo': { id: 'ac5_ammo', type: 'ac5' },
  'ac/10 ammo': { id: 'ac10_ammo', type: 'ac10' },
  'ac/20 ammo': { id: 'ac20_ammo', type: 'ac20' },
  'srm 2 ammo': { id: 'srm2_ammo', type: 'srm2' },
  'srm 4 ammo': { id: 'srm4_ammo', type: 'srm4' },
  'srm 6 ammo': { id: 'srm6_ammo', type: 'srm6' },
  'lrm 5 ammo': { id: 'lrm5_ammo', type: 'lrm5' },
  'lrm 10 ammo': { id: 'lrm10_ammo', type: 'lrm10' },
  'lrm 15 ammo': { id: 'lrm15_ammo', type: 'lrm15' },
  'lrm 20 ammo': { id: 'lrm20_ammo', type: 'lrm20' },
  'machine gun ammo': { id: 'machinegun_ammo', type: 'machinegun' },
  'flamer ammo': { id: 'flamer_ammo', type: 'flamer' },
  'ultra ac/2 ammo': { id: 'uac2_ammo', type: 'uac2' },
  'ultra ac/5 ammo': { id: 'uac5_ammo', type: 'uac5' },
  'ultra ac/10 ammo': { id: 'uac10_ammo', type: 'uac10' },
  'ultra ac/20 ammo': { id: 'uac20_ammo', type: 'uac20' },
  'lb 2-x ac ammo': { id: 'lbx2_ammo', type: 'lbx2' },
  'lb 5-x ac ammo': { id: 'lbx5_ammo', type: 'lbx5' },
  'lb 10-x ac ammo': { id: 'lbx10_ammo', type: 'lbx10' },
  'lb 20-x ac ammo': { id: 'lbx20_ammo', type: 'lbx20' },
  'gauss rifle ammo': { id: 'gauss_ammo', type: 'gauss_rifle' },
  'streak srm 2 ammo': { id: 'streak_srm2_ammo', type: 'streak_srm2' },
  'streak srm 4 ammo': { id: 'streak_srm4_ammo', type: 'streak_srm4' },
  'streak srm 6 ammo': { id: 'streak_srm6_ammo', type: 'streak_srm6' },
  'mrm 10 ammo': { id: 'mrm10_ammo', type: 'mrm10' },
  'mrm 20 ammo': { id: 'mrm20_ammo', type: 'mrm20' },
  'mrm 30 ammo': { id: 'mrm30_ammo', type: 'mrm30' },
  'mrm 40 ammo': { id: 'mrm40_ammo', type: 'mrm40' }
};

const WEAPON_IDS = new Set(Object.values(WEAPON_NAME_MAP));

const AMMO_IDS = new Set(Object.values(AMMO_NAME_MAP).map(v => v.id));

const explosiveAmmo = new Set(Object.values(WEAPON_NAME_MAP));

function mapItemName(rawName) {
  const name = rawName.trim().toLowerCase();
  const ammoMatch = name.match(/^(.+?)\s+ammo$/);
  if (ammoMatch) {
    const baseName = ammoMatch[1].trim();
    const mapped = AMMO_NAME_MAP[name];
    if (mapped) return mapped.id;
    const weaponId = WEAPON_NAME_MAP[baseName];
    if (weaponId) return `${weaponId}_ammo`;
    return name.replace(/[\s\/\-]+/g, '_').toLowerCase() + '_ammo';
  }

  if (WEAPON_NAME_MAP[name]) return WEAPON_NAME_MAP[name];
  if (EQUIPMENT_NAME_MAP[name]) return EQUIPMENT_NAME_MAP[name];
  if (name === 'empty' || name === '-empty-') return 'empty';
  return name.replace(/[\s\/\-()]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').toLowerCase();
}

function isWeapon(mappedId) {
  return WEAPON_IDS.has(mappedId);
}

function isAmmo(mappedId) {
  return AMMO_IDS.has(mappedId) || mappedId.endsWith('_ammo');
}

function getAmmoBaseType(ammoId) {
  return ammoId.replace(/_ammo$/, '');
}

export function parseAndConvert(mtfText) {
  const parsed = parseMTF(mtfText);
  return convertToMechDef(parsed);
}

export function convertToMechDef(parsed) {
  const id = `${parsed.chassis.toLowerCase().replace(/\s+/g, '-')}-${parsed.model.toLowerCase().replace(/\s+/g, '-')}`;
  const name = `${parsed.chassis} ${parsed.model}`;

  const movement = {
    walk: parsed.walkMP,
    run: Math.floor(parsed.walkMP * 1.5),
    jump: parsed.jumpMP
  };

  const armor = convertArmor(parsed.armor);
  const internalStructure = getInternalStructure(parsed.mass);
  const criticalSlots = convertCriticalSlots(parsed.criticalSlots);
  const { equipment, heatSinkSlots } = buildEquipment(criticalSlots);

  const heatSinkCount = parsed.heatSinks.count;

  return {
    id,
    name,
    tonnage: parsed.mass,
    movement,
    armor,
    internalStructure,
    criticalSlots,
    equipment,
    heatSinks: {
      count: heatSinkCount,
      type: parsed.heatSinks.type,
      damaged: 0
    },
    engine: { ...parsed.engine, hits: 0 },
    gyro: { ...parsed.gyro, hits: 0 }
  };
}

function convertArmor(mtfArmor) {
  const result = {};
  for (const loc of Object.keys(mtfArmor)) {
    result[loc] = {
      front: mtfArmor[loc].front || 0,
      rear: mtfArmor[loc].rear || 0
    };
  }
  return result;
}

function convertCriticalSlots(rawSlots) {
  const result = {};
  for (const [location, slots] of Object.entries(rawSlots)) {
    result[location] = slots.map((s, idx) => ({
      slot: idx + 1,
      item: mapItemName(s.item),
      status: s.status || 'ok'
    }));
  }
  return result;
}

function buildEquipment(criticalSlots) {
  const weapons = [];
  const ammo = {};
  let heatSinkSlots = 0;
  const weaponAmmoMap = {};

  for (const [location, slots] of Object.entries(criticalSlots)) {
    for (const slot of slots) {
      const itemId = slot.item;

      if (itemId === 'empty') continue;

      if (isWeapon(itemId)) {
        const entry = { type: itemId, location };
        weapons.push(entry);
        weaponAmmoMap[itemId] = (weaponAmmoMap[itemId] || 0) + 1;
      } else if (isAmmo(itemId)) {
        if (!ammo[itemId]) {
          const baseType = getAmmoBaseType(itemId);
          ammo[itemId] = {
            type: baseType,
            shots: 0,
            explosive: explosiveAmmo.has(baseType)
          };
        }
        ammo[itemId].shots += ammoShotsPerTon[getAmmoBaseType(itemId)] || 0;
      } else if (itemId === 'heat_sink') {
        heatSinkSlots++;
      }
    }
  }

  for (const [ammoId, ammoData] of Object.entries(ammo)) {
    if (ammoData.shots === 0) {
      delete ammo[ammoId];
    }
  }

  return {
    equipment: {
      weapons,
      ammo,
      other: {}
    },
    heatSinkSlots
  };
}
