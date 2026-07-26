import { describe, it, expect } from 'vitest';
import { parseMUL, parseMULToUnits } from '../../src/import/mulParser.js';
import { Unit } from '../../src/models/Unit.js';
import mechsData from '../../src/data/mechs.json' with { type: 'json' };

const atlasMTF = `Version:1.0
Chassis:Atlas
Model:AS7-D
Config:biped
Mass:100
Engine:300 Fusion Engine
Heat Sinks:20 Single
Walk MP:3
Jump MP:0
Gyro:Standard Gyro

HD Armor:9
LA Armor:34
RA Armor:34
LT Armor:32
RT Armor:32
CT Armor:47
LL Armor:41
RL Armor:41
LTR Armor:10
RTR Armor:10
CTR Armor:14

Weapons:1
Medium Laser, RA

Right Arm:
Shoulder
Upper Arm
Lower Arm
Hand Actuator
Medium Laser
-Empty-
-Empty-
-Empty-
-Empty-
-Empty-

Left Arm:
Shoulder
Upper Arm
Lower Arm
Hand Actuator
-Empty-
-Empty-
-Empty-
-Empty-
-Empty-
-Empty-

Left Torso:
-Empty-
-Empty-
-Empty-
-Empty-
-Empty-
-Empty-
-Empty-
-Empty-
-Empty-
-Empty-
-Empty-
-Empty-

Right Torso:
-Empty-
-Empty-
-Empty-
-Empty-
-Empty-
-Empty-
-Empty-
-Empty-
-Empty-
-Empty-
-Empty-
-Empty-

Center Torso:
Engine
Engine
Engine
Gyro
Gyro
Gyro
Gyro
-Empty-
-Empty-
-Empty-
-Empty-
-Empty-

Head:
Life Support
Sensors
Cockpit
Sensors
Life Support
-Empty-

Left Leg:
-Empty-
-Empty-
-Empty-
-Empty-
-Empty-
-Empty-

Right Leg:
-Empty-
-Empty-
-Empty-
-Empty-
-Empty-
-Empty-

Left Arm Actuators:Shoulder,Upper Arm,Lower Arm,Hand
Right Arm Actuators:Shoulder,Upper Arm,Lower Arm,Hand
`;

const twoUnitMUL = `<?xml version="1.0" encoding="UTF-8"?>
<MUL>
  <Unit id="0" chassis="Atlas" model="AS7-D" tonnage="100">
    <Pilot gunnery="3" piloting="4" />
  </Unit>
  <Unit id="1" chassis="Jenner" model="JR7-D" tonnage="35">
    <Pilot gunnery="4" piloting="5" />
  </Unit>
</MUL>`;

const selfClosingMUL = `<MUL>
  <Unit id="0" chassis="Wolverine" model="WVR-6R" tonnage="55"/>
  <Unit id="1" chassis="Thunderbolt" model="TDR-5S" tonnage="65"/>
</MUL>`;

const entityMUL = `<MUL>
  <Unit id="0">
    <Entity chassis="Atlas" model="AS7-D" tonnage="100"/>
    <Pilot gunnery="2" piloting="3"/>
  </Unit>
</MUL>`;

const mixedMUL = `<MUL>
  <Unit id="0" chassis="Atlas" model="AS7-D" tonnage="100"/>
  <Unit id="1" chassis="Jenner" model="JR7-D" tonnage="35">
    <Pilot gunnery="5" piloting="6"/>
  </Unit>
  <Unit id="2">
    <Entity chassis="Wolverine" model="WVR-6R" tonnage="55"/>
    <Pilot gunnery="3" piloting="3"/>
  </Unit>
</MUL>`;

const noPilotMUL = `<MUL>
  <Unit id="0" chassis="Atlas" model="AS7-D" tonnage="100"/>
</MUL>`;

const commentMUL = `<!-- BattleMechs -->
<MUL>
  <!-- Assault Lance -->
  <Unit id="0" chassis="Atlas" model="AS7-D" tonnage="100"/>
  <!-- Another comment -->
  <Unit id="1" chassis="Jenner" model="JR7-D" tonnage="35">
    <Pilot gunnery="4" piloting="5"/>
  </Unit>
</MUL>`;

const mekIdMUL = `<MUL>
  <Unit id="0" chassis="Atlas" model="AS7-D" tonnage="100" mekId="Atlas AS7-D.mtf">
    <Pilot gunnery="4" piloting="5"/>
  </Unit>
</MUL>`;

const unknownMechMUL = `<MUL>
  <Unit id="0" chassis="MadCat" model="Prime" tonnage="75">
    <Pilot gunnery="2" piloting="3"/>
  </Unit>
</MUL>`;

const partialUnitMUL = `<MUL>
  <Unit id="0" chassis="Atlas" model="AS7-D" tonnage="100"/>
  <Unit id="1" chassis="Unknown" model="???" />
</MUL>`;

describe('mulParser', () => {
  describe('parseMUL', () => {
    it('parses a single unit with all attributes', () => {
      const mul = `<MUL><Unit id="0" chassis="Atlas" model="AS7-D" tonnage="100"/></MUL>`;
      const result = parseMUL(mul);
      expect(result).toHaveLength(1);
      expect(result[0].chassis).toBe('Atlas');
      expect(result[0].model).toBe('AS7-D');
      expect(result[0].tonnage).toBe(100);
    });

    it('parses multiple units with opening/closing tags', () => {
      const result = parseMUL(twoUnitMUL);
      expect(result).toHaveLength(2);
      expect(result[0].chassis).toBe('Atlas');
      expect(result[0].model).toBe('AS7-D');
      expect(result[0].tonnage).toBe(100);
      expect(result[1].chassis).toBe('Jenner');
      expect(result[1].model).toBe('JR7-D');
      expect(result[1].tonnage).toBe(35);
    });

    it('parses self-closing unit tags', () => {
      const result = parseMUL(selfClosingMUL);
      expect(result).toHaveLength(2);
      expect(result[0].chassis).toBe('Wolverine');
      expect(result[0].model).toBe('WVR-6R');
      expect(result[0].tonnage).toBe(55);
      expect(result[1].chassis).toBe('Thunderbolt');
      expect(result[1].model).toBe('TDR-5S');
      expect(result[1].tonnage).toBe(65);
    });

    it('extracts pilot skills', () => {
      const result = parseMUL(twoUnitMUL);
      expect(result[0].pilot).toEqual({ gunnery: 3, piloting: 4 });
      expect(result[1].pilot).toEqual({ gunnery: 4, piloting: 5 });
    });

    it('returns null pilot when no Pilot element is present', () => {
      const result = parseMUL(noPilotMUL);
      expect(result[0].pilot).toBeNull();
    });

    it('handles Entity child elements for chassis/model/tonnage', () => {
      const result = parseMUL(entityMUL);
      expect(result).toHaveLength(1);
      expect(result[0].chassis).toBe('Atlas');
      expect(result[0].model).toBe('AS7-D');
      expect(result[0].tonnage).toBe(100);
      expect(result[0].pilot).toEqual({ gunnery: 2, piloting: 3 });
    });

    it('parses empty MUL text', () => {
      const result = parseMUL('');
      expect(result).toEqual([]);
    });

    it('parses empty MUL wrapper with no units', () => {
      const result = parseMUL('<MUL></MUL>');
      expect(result).toEqual([]);
    });

    it('strips XML comments', () => {
      const result = parseMUL(commentMUL);
      expect(result).toHaveLength(2);
      expect(result[0].chassis).toBe('Atlas');
      expect(result[1].chassis).toBe('Jenner');
    });

    it('extracts mekId attribute from Unit tag', () => {
      const result = parseMUL(mekIdMUL);
      expect(result[0].mekId).toBe('Atlas AS7-D.mtf');
    });

    it('parses mixed tag styles in one MUL', () => {
      const result = parseMUL(mixedMUL);
      expect(result).toHaveLength(3);
      expect(result[0].chassis).toBe('Atlas');
      expect(result[0].pilot).toBeNull();
      expect(result[1].chassis).toBe('Jenner');
      expect(result[1].pilot).toEqual({ gunnery: 5, piloting: 6 });
      expect(result[2].chassis).toBe('Wolverine');
      expect(result[2].pilot).toEqual({ gunnery: 3, piloting: 3 });
    });

    it('handles alternative tonnage attribute name "tons"', () => {
      const mul = `<MUL><Unit chassis="Marauder" model="MAD-3R" tons="75"/></MUL>`;
      const result = parseMUL(mul);
      expect(result[0].tonnage).toBe(75);
    });

    it('handles alternative mek_id attribute name', () => {
      const mul = `<MUL><Unit chassis="Atlas" model="AS7-D" tonnage="100" mek_id="atlas.mtf"/></MUL>`;
      const result = parseMUL(mul);
      expect(result[0].mekId).toBe('atlas.mtf');
    });

    it('defaults to empty strings for missing chassis/model', () => {
      const mul = `<MUL><Unit id="0" tonnage="50"/></MUL>`;
      const result = parseMUL(mul);
      expect(result[0].chassis).toBe('');
      expect(result[0].model).toBe('');
      expect(result[0].tonnage).toBe(50);
    });
  });

  describe('parseMULToUnits', () => {
    it('creates Unit instances from roster mechs', () => {
      const units = parseMULToUnits(twoUnitMUL, 0, mechsData);
      expect(units).toHaveLength(2);
      expect(units[0]).toBeInstanceOf(Unit);
      expect(units[0].name).toBe('Atlas AS7-D');
      expect(units[0].tonnage).toBe(100);
      expect(units[1]).toBeInstanceOf(Unit);
      expect(units[1].name).toBe('Jenner JR7-D');
      expect(units[1].tonnage).toBe(35);
    });

    it('assigns player ID to all units', () => {
      const units = parseMULToUnits(twoUnitMUL, 1, mechsData);
      expect(units[0].player).toBe(1);
      expect(units[1].player).toBe(1);
    });

    it('sets pilot skills from MUL', () => {
      const units = parseMULToUnits(twoUnitMUL, 0, mechsData);
      expect(units[0].pilot.gunnery).toBe(3);
      expect(units[0].pilot.piloting).toBe(4);
      expect(units[1].pilot.gunnery).toBe(4);
      expect(units[1].pilot.piloting).toBe(5);
    });

    it('uses default pilot skills when none specified', () => {
      const units = parseMULToUnits(noPilotMUL, 0, mechsData);
      expect(units[0].pilot.gunnery).toBe(4);
      expect(units[0].pilot.piloting).toBe(5);
    });

    it('looks up mechs by chassis+model ID in roster', () => {
      const mul = `<MUL><Unit id="0" chassis="Wolverine" model="WVR-6R" tonnage="55"/></MUL>`;
      const units = parseMULToUnits(mul, 0, mechsData);
      expect(units[0].name).toBe('Wolverine WVR-6R');
      expect(units[0].armor.head.front).toBe(9);
    });

    it('falls back to MTF parsing when mekId references a provided MTF file', () => {
      const mtfFiles = { 'Atlas AS7-D.mtf': atlasMTF };
      const units = parseMULToUnits(mekIdMUL, 0, null, mtfFiles);
      expect(units).toHaveLength(1);
      expect(units[0]).toBeInstanceOf(Unit);
      expect(units[0].name).toBe('Atlas AS7-D');
      expect(units[0].tonnage).toBe(100);
    });

    it('falls back to MTF parsing by constructed filename', () => {
      const mtfFiles = { 'Atlas AS7-D.mtf': atlasMTF };
      const mul = `<MUL><Unit chassis="Atlas" model="AS7-D" tonnage="100"/></MUL>`;
      const units = parseMULToUnits(mul, 0, null, mtfFiles);
      expect(units).toHaveLength(1);
      expect(units[0].name).toBe('Atlas AS7-D');
      expect(units[0].tonnage).toBe(100);
    });

    it('creates stub units for unknown chassis with tonnage', () => {
      const units = parseMULToUnits(unknownMechMUL, 0, mechsData);
      expect(units).toHaveLength(1);
      expect(units[0]).toBeInstanceOf(Unit);
      expect(units[0].name).toBe('MadCat Prime');
      expect(units[0].tonnage).toBe(75);
    });

    it('applies pilot skills to stub units', () => {
      const units = parseMULToUnits(unknownMechMUL, 0, mechsData);
      expect(units[0].pilot.gunnery).toBe(2);
      expect(units[0].pilot.piloting).toBe(3);
    });

    it('estimates movement for stub units by tonnage', () => {
      const units = parseMULToUnits(unknownMechMUL, 0, mechsData);
      expect(units[0].movement.walk).toBe(4);
      expect(units[0].movement.run).toBe(6);
    });

    it('returns empty array for units with no tonnage and no roster match', () => {
      const units = parseMULToUnits(partialUnitMUL, 0, mechsData);
      expect(units).toHaveLength(1);
      expect(units[0].name).toBe('Atlas AS7-D');
    });

    it('prefers roster match over MTF fallback', () => {
      const mtfFiles = { 'Atlas AS7-D.mtf': atlasMTF };
      const units = parseMULToUnits(mekIdMUL, 0, mechsData, mtfFiles);
      expect(units).toHaveLength(1);
      expect(units[0].armor.head.front).toBe(9);
      expect(units[0].equipment.weapons.length).toBeGreaterThan(0);
    });

    it('creates stub units with valid internal structure', () => {
      const units = parseMULToUnits(unknownMechMUL, 0, mechsData);
      expect(units[0].internalStructure.head).toBe(3);
      expect(units[0].internalStructure.centerTorso).toBeGreaterThan(0);
    });

    it('creates stub units with engine and gyro', () => {
      const units = parseMULToUnits(unknownMechMUL, 0, mechsData);
      expect(units[0].engine.type).toBe('standard');
      expect(units[0].engine.rating).toBe(300);
      expect(units[0].gyro.type).toBe('standard');
    });

    it('creates stub units with correct movement by tonnage bracket', () => {
      const lightMUL = `<MUL><Unit chassis="Light" model="Mech" tonnage="30"/></MUL>`;
      const mediumMUL = `<MUL><Unit chassis="Medium" model="Mech" tonnage="50"/></MUL>`;
      const heavyMUL = `<MUL><Unit chassis="Heavy" model="Mech" tonnage="65"/></MUL>`;
      const assaultMUL = `<MUL><Unit chassis="Assault" model="Mech" tonnage="85"/></MUL>`;

      expect(parseMULToUnits(lightMUL, 0, mechsData)[0].movement.walk).toBe(6);
      expect(parseMULToUnits(mediumMUL, 0, mechsData)[0].movement.walk).toBe(5);
      expect(parseMULToUnits(heavyMUL, 0, mechsData)[0].movement.walk).toBe(4);
      expect(parseMULToUnits(assaultMUL, 0, mechsData)[0].movement.walk).toBe(3);
    });
  });
});
