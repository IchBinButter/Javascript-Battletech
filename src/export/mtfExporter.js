/**
 * MTF (Mech Task Force) Exporter
 * Converts an internal mech definition (mechDef) back to MegaMek .mtf format text.
 *
 * This is the reverse of the src/import/ pipeline:
 *   mechDef → MTF text
 */

// ── Location maps ──────────────────────────────────────────────────────────

const LOCATION_TO_MTF_SECTION = {
  head: "Head",
  centerTorso: "Center Torso",
  leftTorso: "Left Torso",
  rightTorso: "Right Torso",
  leftArm: "Left Arm",
  rightArm: "Right Arm",
  leftLeg: "Left Leg",
  rightLeg: "Right Leg"
};

const LOCATION_TO_ARMOR_ABBREV = {
  head: "HD",
  centerTorso: "CT",
  leftTorso: "LT",
  rightTorso: "RT",
  leftArm: "LA",
  rightArm: "RA",
  leftLeg: "LL",
  rightLeg: "RL"
};

const REAR_ARMOR_ABBREV = {
  centerTorso: "CTR",
  leftTorso: "LTR",
  rightTorso: "RTR"
};

const LOCATION_TO_WEAPON_ABBREV = {
  head: "HD",
  centerTorso: "CT",
  leftTorso: "LT",
  rightTorso: "RT",
  leftArm: "LA",
  rightArm: "RA",
  leftLeg: "LL",
  rightLeg: "RL"
};

const LOCATIONS_ORDER = [
  "head", "centerTorso", "leftTorso", "rightTorso",
  "leftArm", "rightArm", "leftLeg", "rightLeg"
];

// ── Reverse name mappings (internal ID → MTF display name) ─────────────────

const WEAPON_ID_TO_MTF = {
  med_laser: "Medium Laser",
  med_laser_rear: "Medium Laser (R)",
  med_pulse_laser: "Medium Pulse Laser",
  er_med_laser: "ER Medium Laser",
  large_laser: "Large Laser",
  large_laser_rear: "Large Laser (R)",
  large_pulse_laser: "Large Pulse Laser",
  er_large_laser: "ER Large Laser",
  small_laser: "Small Laser",
  small_pulse_laser: "Small Pulse Laser",
  er_small_laser: "ER Small Laser",
  ppc: "PPC",
  er_ppc: "ER PPC",
  light_ppc: "Light PPC",
  heavy_ppc: "Heavy PPC",
  snub_nose_ppc: "Snub-Nose PPC",
  ac2: "AC/2",
  ac5: "AC/5",
  ac10: "AC/10",
  ac20: "AC/20",
  uac2: "Ultra AC/2",
  uac5: "Ultra AC/5",
  uac10: "Ultra AC/10",
  uac20: "Ultra AC/20",
  lbx2: "LB 2-X AC",
  lbx5: "LB 5-X AC",
  lbx10: "LB 10-X AC",
  lbx20: "LB 20-X AC",
  rac2: "Rotary AC/2",
  rac5: "Rotary AC/5",
  gauss_rifle: "Gauss Rifle",
  light_gauss: "Light Gauss Rifle",
  heavy_gauss: "Heavy Gauss Rifle",
  srm2: "SRM 2",
  srm4: "SRM 4",
  srm6: "SRM 6",
  streak_srm2: "Streak SRM 2",
  streak_srm4: "Streak SRM 4",
  streak_srm6: "Streak SRM 6",
  lrm5: "LRM 5",
  lrm10: "LRM 10",
  lrm15: "LRM 15",
  lrm20: "LRM 20",
  mrm10: "MRM 10",
  mrm20: "MRM 20",
  mrm30: "MRM 30",
  mrm40: "MRM 40",
  rl10: "Rocket Launcher 10",
  rl15: "Rocket Launcher 15",
  rl20: "Rocket Launcher 20",
  machinegun: "Machine Gun",
  light_machinegun: "Light Machine Gun",
  heavy_machinegun: "Heavy Machine Gun",
  flamer: "Flamer",
  heavy_flamer: "Heavy Flamer",
  er_flamer: "ER Flamer",
  small_xpulse: "Small X-Pulse Laser",
  medium_xpulse: "Medium X-Pulse Laser",
  large_xpulse: "Large X-Pulse Laser",
  plasma_rifle: "Plasma Rifle",
  plasma_cannon: "Plasma Cannon"
};

const EQUIPMENT_ID_TO_MTF = {
  heat_sink: "Heat Sink",
  double_heat_sink: "ISDouble Heat Sink",
  jump_jet: "Jump Jet",
  life_support: "Life Support",
  sensors: "Sensors",
  cockpit: "Cockpit",
  engine: "Engine",
  gyro: "Gyro",
  shoulder: "Shoulder",
  upper_arm_actuator: "Upper Arm",
  lower_arm_actuator: "Lower Arm",
  hand_actuator: "Hand Actuator",
  hip: "Hip",
  upper_leg_actuator: "Upper Leg",
  lower_leg_actuator: "Lower Leg",
  foot_actuator: "Foot Actuator",
  case: "CASE",
  endo_steel: "Endo Steel",
  ferro_fibrous: "Ferro-Fibrous",
  targeting_computer: "Targeting Computer",
  masc: "MASC",
  tsm: "TSM",
  ecm: "ECM Suite",
  artemis_iv: "Artemis IV FCS",
  c3_slave: "C3 Slave",
  c3_master: "C3 Master",
  c3i: "C3i",
  tag: "TAG",
  narc: "Narc",
  ams: "AMS",
  a_pod: "A-Pod",
  beagle_active_probe: "Active Probe",
  medium_shield: "Medium Shield",
  large_shield: "Large Shield"
};

const AMMO_ID_TO_MTF = {
  ac2_ammo: "AC/2 Ammo",
  ac5_ammo: "AC/5 Ammo",
  ac10_ammo: "AC/10 Ammo",
  ac20_ammo: "AC/20 Ammo",
  srm2_ammo: "SRM 2 Ammo",
  srm4_ammo: "SRM 4 Ammo",
  srm6_ammo: "SRM 6 Ammo",
  lrm5_ammo: "LRM 5 Ammo",
  lrm10_ammo: "LRM 10 Ammo",
  lrm15_ammo: "LRM 15 Ammo",
  lrm20_ammo: "LRM 20 Ammo",
  machinegun_ammo: "Machine Gun Ammo",
  flamer_ammo: "Flamer Ammo",
  uac2_ammo: "Ultra AC/2 Ammo",
  uac5_ammo: "Ultra AC/5 Ammo",
  uac10_ammo: "Ultra AC/10 Ammo",
  uac20_ammo: "Ultra AC/20 Ammo",
  lbx2_ammo: "LB 2-X AC Ammo",
  lbx5_ammo: "LB 5-X AC Ammo",
  lbx10_ammo: "LB 10-X AC Ammo",
  lbx20_ammo: "LB 20-X AC Ammo",
  gauss_ammo: "Gauss Rifle Ammo",
  streak_srm2_ammo: "Streak SRM 2 Ammo",
  streak_srm4_ammo: "Streak SRM 4 Ammo",
  streak_srm6_ammo: "Streak SRM 6 Ammo",
  mrm10_ammo: "MRM 10 Ammo",
  mrm20_ammo: "MRM 20 Ammo",
  mrm30_ammo: "MRM 30 Ammo",
  mrm40_ammo: "MRM 40 Ammo"
};

// ── Engine type mapping (internal → MTF) ────────────────────────────────────

const ENGINE_TYPE_MTF = {
  standard: "Fusion Engine",
  xl: "XL Engine",
  light: "Light Engine",
  compact: "Compact Engine"
};

const GYRO_TYPE_MTF = {
  standard: "Standard Gyro",
  xl: "XL Gyro",
  compact: "Compact Gyro",
  heavy_duty: "Heavy Duty Gyro"
};

// ── Critical slot count per location based on mech type (standard biped) ───

const CRIT_SLOT_COUNTS = {
  head: 6,
  centerTorso: 12,
  leftTorso: 12,
  rightTorso: 12,
  leftArm: 12,
  rightArm: 12,
  leftLeg: 6,
  rightLeg: 6
};

// ── Actuator detection maps ─────────────────────────────────────────────────

const ARM_ACTUATOR_ORDER = ["shoulder", "upper_arm_actuator", "lower_arm_actuator", "hand_actuator"];
const LEG_ACTUATOR_ORDER = ["hip", "upper_leg_actuator", "lower_leg_actuator", "foot_actuator"];

const ARM_ACTUATOR_MTF_NAMES = {
  shoulder: "Shoulder",
  upper_arm_actuator: "Upper Arm",
  lower_arm_actuator: "Lower Arm",
  hand_actuator: "Hand"
};

const LEG_ACTUATOR_MTF_NAMES = {
  hip: "Hip",
  upper_leg_actuator: "Upper Leg",
  lower_leg_actuator: "Lower Leg",
  foot_actuator: "Foot"
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Convert an internal item ID back to an MTF display name.
 * Falls back to a human-readable conversion when no mapping exists.
 */
function mtfItemName(internalId) {
  if (internalId === "empty" || internalId === "-Empty-") {
    return "-Empty-";
  }

  if (WEAPON_ID_TO_MTF[internalId]) return WEAPON_ID_TO_MTF[internalId];
  if (EQUIPMENT_ID_TO_MTF[internalId]) return EQUIPMENT_ID_TO_MTF[internalId];
  if (AMMO_ID_TO_MTF[internalId]) return AMMO_ID_TO_MTF[internalId];

  return internalId
    .replace(/_/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Split a mech name into chassis and model.
 * e.g. "Atlas AS7-D" → { chassis: "Atlas", model: "AS7-D" }
 * e.g. "Shadow Hawk SHD-2H" → { chassis: "Shadow Hawk", model: "SHD-2H" }
 */
function splitChassisModel(name) {
  const parts = name.split(" ");
  if (parts.length === 1) {
    return { chassis: parts[0], model: "" };
  }
  const model = parts[parts.length - 1];
  const chassis = parts.slice(0, -1).join(" ");
  return { chassis, model };
}

/**
 * Count "heat_sink" entries in critical slots.
 */
function countCritHeatSinks(criticalSlots) {
  let count = 0;
  for (const location of LOCATIONS_ORDER) {
    const slots = criticalSlots[location];
    if (!slots) continue;
    for (const slot of slots) {
      if (slot.item === "heat_sink") count++;
    }
  }
  return count;
}

/**
 * Detect actuators present in an arm or leg location's critical slots.
 */
function detectActuators(criticalSlots, location, actuatorOrder) {
  const slots = criticalSlots[location];
  if (!slots) return [];
  const found = [];
  for (const act of actuatorOrder) {
    if (slots.some(s => s.item === act)) {
      found.push(act);
    }
  }
  return found;
}

// ── Section builders ────────────────────────────────────────────────────────

/**
 * Build the header lines of the MTF file.
 */
function buildHeader(mechDef) {
  const { chassis, model } = splitChassisModel(mechDef.name);
  const engineType = ENGINE_TYPE_MTF[mechDef.engine.type] || "Fusion Engine";
  const gyroType = GYRO_TYPE_MTF[mechDef.gyro.type] || "Standard Gyro";
  const hsType = mechDef.heatSinks.type === "double" ? "Double" : "Single";

  // The MTF header records the total number of heat sinks; the ones that take
  // critical slots are already listed in the critical sections below (p50).
  const headerHS = mechDef.heatSinks.count;

  const lines = [
    "Version:1.0",
    "generator:megameklab",
    "Chassis:" + chassis,
    "Model:" + model,
    "Config:Biped",
    "",
    "TechBase:Inner Sphere",
    "Mass:" + mechDef.tonnage,
    "Engine:" + mechDef.engine.rating + " " + engineType,
    "Gyro:" + gyroType,
    "Heat Sinks:" + headerHS + " " + hsType,
    "Walk MP:" + mechDef.movement.walk,
    "Jump MP:" + mechDef.movement.jump,
    "",
    "armor:Standard",
    ""
  ];

  return lines;
}

/**
 * Build armor value lines.
 */
function buildArmor(armor) {
  const lines = [];

  for (const location of LOCATIONS_ORDER) {
    const loc = armor[location];
    if (!loc) continue;

    const frontAbbrev = LOCATION_TO_ARMOR_ABBREV[location];
    if (frontAbbrev) {
      lines.push(frontAbbrev + " Armor:" + (loc.front || 0));
    }

    const rearAbbrev = REAR_ARMOR_ABBREV[location];
    if (rearAbbrev && (loc.rear || 0) > 0) {
      lines.push(rearAbbrev + " Armor:" + loc.rear);
    }
  }

  lines.push("");
  return lines;
}

/**
 * Build the weapons list section.
 */
function buildWeaponsList(equipment) {
  const weapons = equipment.weapons || [];
  const lines = [];
  lines.push("Weapons:" + weapons.length);

  for (const wp of weapons) {
    const abbrev = LOCATION_TO_WEAPON_ABBREV[wp.location] || wp.location;
    const mtfName = WEAPON_ID_TO_MTF[wp.type] || mtfItemName(wp.type);
    const isRear = wp.type.endsWith("_rear");
    const displayName = isRear && !mtfName.includes("(R)")
      ? mtfName + " (R)"
      : mtfName;

    lines.push(displayName + ", " + abbrev);
  }

  if (weapons.length > 0) {
    lines.push("");
  }

  return lines;
}

/**
 * Build critical slot sections.
 */
function buildCriticalSections(criticalSlots) {
  const lines = [];

  for (const location of LOCATIONS_ORDER) {
    const sectionName = LOCATION_TO_MTF_SECTION[location];
    const slots = criticalSlots[location];
    const expectedCount = CRIT_SLOT_COUNTS[location] || 12;

    lines.push(sectionName + ":");

    if (slots && slots.length > 0) {
      for (const slot of slots) {
        lines.push(mtfItemName(slot.item));
      }
      for (let i = slots.length; i < expectedCount; i++) {
        lines.push("-Empty-");
      }
    } else {
      for (let i = 0; i < expectedCount; i++) {
        lines.push("-Empty-");
      }
    }

    lines.push("");
  }

  return lines;
}

/**
 * Build actuator summary lines.
 */
function buildActuatorLines(criticalSlots) {
  const lines = [];

  const laActuators = detectActuators(criticalSlots, "leftArm", ARM_ACTUATOR_ORDER);
  if (laActuators.length > 0) {
    const names = laActuators.map(a => ARM_ACTUATOR_MTF_NAMES[a] || a).join(",");
    lines.push("Left Arm Actuators:" + names);
  }

  const raActuators = detectActuators(criticalSlots, "rightArm", ARM_ACTUATOR_ORDER);
  if (raActuators.length > 0) {
    const names = raActuators.map(a => ARM_ACTUATOR_MTF_NAMES[a] || a).join(",");
    lines.push("Right Arm Actuators:" + names);
  }

  const llActuators = detectActuators(criticalSlots, "leftLeg", LEG_ACTUATOR_ORDER);
  if (llActuators.length > 0) {
    const names = llActuators.map(a => LEG_ACTUATOR_MTF_NAMES[a] || a).join(",");
    lines.push("Left Leg Actuators:" + names);
  }

  const rlActuators = detectActuators(criticalSlots, "rightLeg", LEG_ACTUATOR_ORDER);
  if (rlActuators.length > 0) {
    const names = rlActuators.map(a => LEG_ACTUATOR_MTF_NAMES[a] || a).join(",");
    lines.push("Right Leg Actuators:" + names);
  }

  return lines;
}

// ── Main export function ────────────────────────────────────────────────────

/**
 * Convert a mech definition object to MTF format text.
 *
 * @param {Object} mechDef - The internal mech definition (as stored in mechs.json
 *   or produced by unitConverter.convertToMechDef).
 * @returns {string} The mech as an MTF-formatted string.
 */
export function mechDefToMTF(mechDef) {
  const sections = [
    ...buildHeader(mechDef),
    ...buildArmor(mechDef.armor),
    ...buildWeaponsList(mechDef.equipment),
    ...buildCriticalSections(mechDef.criticalSlots),
    ...buildActuatorLines(mechDef.criticalSlots)
  ];

  return sections.join("\n");
}
