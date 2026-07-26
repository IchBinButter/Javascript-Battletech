const LOCATION_MAP = {
  'Head': 'head',
  'Center Torso': 'centerTorso',
  'Left Torso': 'leftTorso',
  'Right Torso': 'rightTorso',
  'Left Arm': 'leftArm',
  'Right Arm': 'rightArm',
  'Left Leg': 'leftLeg',
  'Right Leg': 'rightLeg'
};

const LOCATION_ABBREV = {
  'HD': 'head',
  'CT': 'centerTorso',
  'CTR': 'centerTorso',
  'RT': 'rightTorso',
  'RTR': 'rightTorso',
  'LT': 'leftTorso',
  'LTR': 'leftTorso',
  'RA': 'rightArm',
  'LA': 'leftArm',
  'RL': 'rightLeg',
  'LL': 'leftLeg'
};

const REAR_ARMOR_ABBREV = new Set(['CTR', 'RTR', 'LTR']);

const SECTION_HEADERS = [
  'Head:',
  'Center Torso:',
  'Left Torso:',
  'Right Torso:',
  'Left Arm:',
  'Right Arm:',
  'Left Leg:',
  'Right Leg:'
];

function normalizeKey(key) {
  return key.trim().toLowerCase();
}

function parseValue(value) {
  return value.trim();
}

function parseHeaderSection(lines, startIdx) {
  const header = {};
  let i = startIdx;

  while (i < lines.length) {
    const line = lines[i].trim();
    if (line === '') {
      i++;
      continue;
    }

    if (SECTION_HEADERS.some(h => line.toLowerCase().startsWith(h.toLowerCase()))) {
      break;
    }

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) {
      i++;
      continue;
    }

    const key = normalizeKey(line.substring(0, colonIdx));
    const value = parseValue(line.substring(colonIdx + 1));
    header[key] = value;
    i++;
  }

  return { header, nextIdx: i };
}

function parseArmorLines(lines, armorSectionStart) {
  const armor = {};
  let i = armorSectionStart;
  const armorLineRegex = /^(HD|CTR?|RTR?|LTR?|RA|LA|RL|LL)\s+Armor:(.+)$/i;

  while (i < lines.length) {
    const line = lines[i].trim();
    const match = line.match(armorLineRegex);

    if (!match) break;

    const abbrev = match[1].toUpperCase();
    const value = parseInt(match[2].trim(), 10) || 0;
    const location = LOCATION_ABBREV[abbrev];

    if (location) {
      if (!armor[location]) {
        armor[location] = { front: 0, rear: 0 };
      }
      if (REAR_ARMOR_ABBREV.has(abbrev)) {
        armor[location].rear = value;
      } else {
        armor[location].front = value;
      }
    }
    i++;
  }

  return { armor, nextIdx: i };
}

function parseWeaponsList(lines, startIdx) {
  const weapons = [];
  let i = startIdx;

  const weaponsHeader = lines[i].trim().match(/^Weapons:(\d+)$/i);
  if (!weaponsHeader) {
    return { weapons: [], nextIdx: startIdx };
  }

  const weaponCount = parseInt(weaponsHeader[1], 10);
  i++;

  for (let w = 0; w < weaponCount && i < lines.length; w++) {
    const line = lines[i].trim();
    if (line === '') {
      i++;
      w--;
      continue;
    }
    if (SECTION_HEADERS.some(h => line.toLowerCase().startsWith(h.toLowerCase()))) {
      break;
    }

    const parts = line.split(',');
    const name = parts[0].trim();
    const locAbbrev = parts[1] ? parts[1].trim() : '';
    const location = LOCATION_ABBREV[locAbbrev] || null;
    const rear = name.toLowerCase().includes('(r)');

    weapons.push({ name, location, rear });
    i++;
  }

  return { weapons, nextIdx: i };
}

function parseCriticalSections(lines, startIdx) {
  const criticalSlots = {};
  let i = startIdx;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (line === '') {
      i++;
      continue;
    }

    const sectionMatch = SECTION_HEADERS.find(h =>
      line.toLowerCase().startsWith(h.toLowerCase())
    );

    if (!sectionMatch) {
      if (line.toLowerCase().startsWith('left arm actuators:') ||
          line.toLowerCase().startsWith('right arm actuators:') ||
          line.toLowerCase().startsWith('left leg actuators:') ||
          line.toLowerCase().startsWith('right leg actuators:')) {
        i++;
        continue;
      }
      i++;
      continue;
    }

    const rawName = sectionMatch.replace(':', '').trim();
    const location = LOCATION_MAP[rawName];
    if (!location) {
      i++;
      continue;
    }

    criticalSlots[location] = [];
    i++;

    while (i < lines.length) {
      const slotLine = lines[i].trim();

      if (slotLine === '') {
        if (i + 1 < lines.length && SECTION_HEADERS.some(h =>
          lines[i + 1].trim().toLowerCase().startsWith(h.toLowerCase()))) {
          i++;
          break;
        }
        i++;
        continue;
      }

      if (SECTION_HEADERS.some(h =>
        slotLine.toLowerCase().startsWith(h.toLowerCase()))) {
        break;
      }

      if (slotLine.startsWith('Left Arm Actuators:') ||
          slotLine.startsWith('Right Arm Actuators:') ||
          slotLine.startsWith('Left Leg Actuators:') ||
          slotLine.startsWith('Right Leg Actuators:')) {
        break;
      }

      const slotNum = criticalSlots[location].length + 1;
      const item = slotLine === '-Empty-' || slotLine === 'Empty' ? 'empty' : slotLine;
      criticalSlots[location].push({ slot: slotNum, item, status: 'ok' });
      i++;
    }
  }

  return criticalSlots;
}

function parseArmorSection(lines, startIdx) {
  const armor = {
    head: { front: 0, rear: 0 },
    centerTorso: { front: 0, rear: 0 },
    leftTorso: { front: 0, rear: 0 },
    rightTorso: { front: 0, rear: 0 },
    leftArm: { front: 0, rear: 0 },
    rightArm: { front: 0, rear: 0 },
    leftLeg: { front: 0, rear: 0 },
    rightLeg: { front: 0, rear: 0 }
  };

  let i = startIdx;
  const armorTypeLine = lines[i].trim();
  const armorTypeMatch = armorTypeLine.match(/^Armor:(.+)/i);
  if (armorTypeMatch) {
    i++;
  }

  return parseArmorLines(lines, i);
}

function findSectionStart(lines, regex) {
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i].trim())) {
      return i;
    }
  }
  return -1;
}

export function parseMTF(text) {
  const lines = text.split(/\r?\n/);
  const cleanLines = lines.map(l => l.replace(/\r$/, ''));

  const { header, nextIdx: afterHeader } = parseHeaderSection(cleanLines, 0);

  const config = header['config'] || 'Biped';
  const chassis = header['chassis'] || '';
  const model = header['model'] || '';
  const mass = parseInt(header['mass'], 10) || 0;
  const walkMP = parseInt(header['walk mp'], 10) || 0;
  const jumpMP = parseInt(header['jump mp'], 10) || 0;

  const engineStr = header['engine'] || '';
  const engineMatch = engineStr.match(/(\d+)\s*(.*)/);
  const engineRating = engineMatch ? parseInt(engineMatch[1], 10) : 0;
  const engineType = engineMatch ? engineMatch[2].trim().replace(/\s*engine$/i, '') : '';
  const engineMapped = mapEngineType(engineType);

  const heatSinkStr = header['heat sinks'] || '10 Single';
  const hsMatch = heatSinkStr.match(/(\d+)\s*(.*)/);
  const heatSinkCount = hsMatch ? parseInt(hsMatch[1], 10) : 10;
  const heatSinkTypeRaw = hsMatch ? hsMatch[2].trim() : 'Single';
  const heatSinkType = heatSinkTypeRaw.toLowerCase() === 'double' ? 'double' : 'single';

  const armorStartIdx = findSectionStart(cleanLines, /^HD\s+Armor:/i);
  let armorResult;
  if (armorStartIdx >= 0) {
    armorResult = parseArmorSection(cleanLines, armorStartIdx);
  } else {
    armorResult = {
      armor: {
        head: { front: 0, rear: 0 },
        centerTorso: { front: 0, rear: 0 },
        leftTorso: { front: 0, rear: 0 },
        rightTorso: { front: 0, rear: 0 },
        leftArm: { front: 0, rear: 0 },
        rightArm: { front: 0, rear: 0 },
        leftLeg: { front: 0, rear: 0 },
        rightLeg: { front: 0, rear: 0 }
      },
      nextIdx: 0
    };
  }

  const weaponsStartIdx = findSectionStart(cleanLines, /^Weapons:/i);
  let weaponsResult;
  if (weaponsStartIdx >= 0) {
    weaponsResult = parseWeaponsList(cleanLines, weaponsStartIdx);
  } else {
    weaponsResult = { weapons: [], nextIdx: 0 };
  }

  const critStartIdx = findSectionStart(cleanLines, /^(Head|Center Torso|Left Torso|Right Torso|Left Arm|Right Arm|Left Leg|Right Leg):/i);
  let criticalSlots;
  if (critStartIdx >= 0) {
    criticalSlots = parseCriticalSections(cleanLines, critStartIdx);
  } else {
    criticalSlots = {};
  }

  const gyroStr = header['gyro'] || 'Standard Gyro';
  const gyroType = gyroStr.replace(/\s*gyro$/i, '').trim();

  return {
    config,
    chassis,
    model,
    mass,
    walkMP,
    jumpMP,
    engine: { type: engineMapped, rating: engineRating },
    heatSinks: { count: heatSinkCount, type: heatSinkType },
    gyro: { type: mapGyroType(gyroType) },
    armor: armorResult.armor,
    weaponsList: weaponsResult.weapons,
    criticalSlots,
    rawHeader: header
  };
}

function mapEngineType(typeStr) {
  const lower = typeStr.toLowerCase().trim();
  if (lower.includes('xl') || lower.includes('extra-light')) return 'xl';
  if (lower.includes('light')) return 'light';
  if (lower.includes('compact')) return 'compact';
  return 'standard';
}

function mapGyroType(typeStr) {
  const lower = typeStr.toLowerCase().trim();
  if (lower.includes('xl') || lower.includes('extra-light')) return 'xl';
  if (lower.includes('compact')) return 'compact';
  if (lower.includes('heavy duty')) return 'heavy_duty';
  return 'standard';
}
