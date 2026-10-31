/**
 * Record-sheet UI kit.
 *
 * Plain DOM + inline SVG, no dependencies. Every maximum comes from the unit
 * (`getMaxArmor`, `getMaxInternal`) and every rules table from the data files
 * the engine itself reads.
 */

export { ArmorDiagram } from './armorDiagram.js';
export { InternalStructureDiagram } from './internalStructureDiagram.js';
export { WeaponsTable, WEAPON_COLUMNS } from './weaponsTable.js';
export { HeatScale } from './heatScale.js';
export { CritTables } from './critTables.js';
export { WarriorData } from './warriorData.js';
export { RecordCard } from './recordCard.js';
export { RecordSheet, MechDataPanel } from './recordSheet.js';
export { LOCATIONS, LOCATION_KEYS, TORSO_KEYS, shortLocation, longLocation } from './locations.js';
