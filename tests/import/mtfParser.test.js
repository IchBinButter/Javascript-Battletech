import { describe, it, expect } from 'vitest';
import { parseMTF } from '../../src/import/mtfParser.js';
import { convertToMechDef, parseAndConvert } from '../../src/import/unitConverter.js';

const atlasMTF = `Version:1.0
generator:megameklab
Chassis:Atlas
clan name:
Model:AS7-D
mul id:6635
Config:biped

TechBase:Inner Sphere
TechLevel:Standard
Mass:100
Engine:300 Fusion Engine
cockpit:Standard cockpit
Gyro:Standard Gyro
Heat Sinks:20 Single
Walk MP:3
Jump MP:0

Myomer:Standard
Internal:Standard
armor:Standard

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

Weapons:15
Medium Laser, RA
Medium Laser, RA
Medium Laser, RA
Medium Laser, RA
Medium Laser (R), CT
Medium Laser (R), CT
SRM 6, LT
LRM 20, LT
AC/20, RT
Machine Gun, RA
Machine Gun, RA
Flamer, LA
PPC, RT
Large Laser, LA
Small Laser, HD

Left Arm:
Shoulder
Upper Arm
Lower Arm
Hand Actuator
Large Laser
Large Laser
Flamer
-Empty-
-Empty-
-Empty-
-Empty-

Right Arm:
Shoulder
Upper Arm
Lower Arm
Hand Actuator
Medium Laser
Medium Laser
Medium Laser
Medium Laser
Machine Gun
Machine Gun

Left Torso:
Heat Sink
Heat Sink
SRM 6
SRM 6
SRM 6 Ammo
SRM 6 Ammo
LRM 20 Ammo
LRM 20 Ammo
Jump Jet
Jump Jet
-Empty-
-Empty-

Right Torso:
AC/20
AC/20
AC/20
AC/20
AC/20
AC/20
AC/20
AC/20
AC/20
AC/20
AC/20 Ammo
AC/20 Ammo

Center Torso:
Engine
Engine
Engine
Gyro
Gyro
Gyro
Gyro
Medium Laser (R)
Medium Laser (R)
AC/20 Ammo
-Empty-
-Empty-

Head:
Life Support
Sensors
Cockpit
Small Laser
Sensors
Life Support

Left Leg:
Heat Sink
Heat Sink
-Empty-
-Empty-
-Empty-
-Empty-

Right Leg:
Heat Sink
Heat Sink
-Empty-
-Empty-
-Empty-
-Empty-

Left Arm Actuators:Shoulder,Upper Arm,Lower Arm,Hand
Right Arm Actuators:Shoulder,Upper Arm,Lower Arm,Hand
`;

describe('mtfParser', () => {
  describe('parseMTF', () => {
    it('parses chassis and model', () => {
      const result = parseMTF(atlasMTF);
      expect(result.chassis).toBe('Atlas');
      expect(result.model).toBe('AS7-D');
    });

    it('parses config', () => {
      const result = parseMTF(atlasMTF);
      expect(result.config).toBe('biped');
    });

    it('parses mass', () => {
      const result = parseMTF(atlasMTF);
      expect(result.mass).toBe(100);
    });

    it('parses engine rating and type', () => {
      const result = parseMTF(atlasMTF);
      expect(result.engine.rating).toBe(300);
      expect(result.engine.type).toBe('standard');
    });

    it('parses heat sinks', () => {
      const result = parseMTF(atlasMTF);
      expect(result.heatSinks.count).toBe(20);
      expect(result.heatSinks.type).toBe('single');
    });

    it('parses movement points', () => {
      const result = parseMTF(atlasMTF);
      expect(result.walkMP).toBe(3);
      expect(result.jumpMP).toBe(0);
    });

    it('parses gyro type', () => {
      const result = parseMTF(atlasMTF);
      expect(result.gyro.type).toBe('standard');
    });

    it('parses armor values', () => {
      const result = parseMTF(atlasMTF);
      expect(result.armor.head.front).toBe(9);
      expect(result.armor.centerTorso.front).toBe(47);
      expect(result.armor.centerTorso.rear).toBe(14);
      expect(result.armor.leftTorso.front).toBe(32);
      expect(result.armor.leftTorso.rear).toBe(10);
      expect(result.armor.rightTorso.front).toBe(32);
      expect(result.armor.rightTorso.rear).toBe(10);
      expect(result.armor.leftArm.front).toBe(34);
      expect(result.armor.rightArm.front).toBe(34);
      expect(result.armor.leftLeg.front).toBe(41);
      expect(result.armor.rightLeg.front).toBe(41);
    });

    it('parses weapons list', () => {
      const result = parseMTF(atlasMTF);
      expect(result.weaponsList.length).toBe(15);
      expect(result.weaponsList[0]).toEqual({ name: 'Medium Laser', location: 'rightArm', rear: false });
      expect(result.weaponsList[4]).toEqual({ name: 'Medium Laser (R)', location: 'centerTorso', rear: true });
      expect(result.weaponsList[6]).toEqual({ name: 'SRM 6', location: 'leftTorso', rear: false });
      expect(result.weaponsList[8]).toEqual({ name: 'AC/20', location: 'rightTorso', rear: false });
    });

    it('parses critical slots', () => {
      const result = parseMTF(atlasMTF);
      const locations = Object.keys(result.criticalSlots);
      expect(locations).toContain('head');
      expect(locations).toContain('centerTorso');
      expect(locations).toContain('leftTorso');
      expect(locations).toContain('rightTorso');
      expect(locations).toContain('leftArm');
      expect(locations).toContain('rightArm');
      expect(locations).toContain('leftLeg');
      expect(locations).toContain('rightLeg');
    });

    it('parses head critical slots', () => {
      const result = parseMTF(atlasMTF);
      const head = result.criticalSlots.head;
      expect(head).toHaveLength(6);
      expect(head[0].item).toBe('Life Support');
      expect(head[1].item).toBe('Sensors');
      expect(head[2].item).toBe('Cockpit');
      expect(head[3].item).toBe('Small Laser');
      expect(head[4].item).toBe('Sensors');
      expect(head[5].item).toBe('Life Support');
    });

    it('maps empty slots correctly', () => {
      const result = parseMTF(atlasMTF);
      const leftLeg = result.criticalSlots.leftLeg;
      expect(leftLeg[2].item).toBe('empty');
      expect(leftLeg[3].item).toBe('empty');
    });

    it('parses center torso critical slots', () => {
      const result = parseMTF(atlasMTF);
      const ct = result.criticalSlots.centerTorso;
      expect(ct).toHaveLength(12);
      expect(ct[0].item).toBe('Engine');
      expect(ct[3].item).toBe('Gyro');
      expect(ct[7].item).toBe('Medium Laser (R)');
    });

    it('parses right torso critical slots with AC/20', () => {
      const result = parseMTF(atlasMTF);
      const rt = result.criticalSlots.rightTorso;
      expect(rt).toHaveLength(12);
      expect(rt[0].item).toBe('AC/20');
      expect(rt[9].item).toBe('AC/20');
      expect(rt[10].item).toBe('AC/20 Ammo');
    });

    it('parses empty MTF text gracefully', () => {
      const result = parseMTF('');
      expect(result.chassis).toBe('');
      expect(result.mass).toBe(0);
      expect(result.weaponsList).toEqual([]);
      expect(result.criticalSlots).toEqual({});
    });

    it('parses MTF with Double heat sinks', () => {
      const mtf = `Mass:55
Engine:275 Fusion Engine
Heat Sinks:10 Double
Walk MP:5
Jump MP:5
`;
      const result = parseMTF(mtf);
      expect(result.heatSinks.count).toBe(10);
      expect(result.heatSinks.type).toBe('double');
    });

    it('parses MTF with XL engine', () => {
      const mtf = `Mass:75
Engine:375 XL Engine
`;
      const result = parseMTF(mtf);
      expect(result.engine.rating).toBe(375);
      expect(result.engine.type).toBe('xl');
    });
  });

  describe('minimal MTF parsing', () => {
    it('parses a minimal chassis definition', () => {
      const mtf = `Chassis:Jenner
Model:JR7-D
Mass:35
Engine:245 Fusion Engine
Heat Sinks:10 Single
Walk MP:7
Jump MP:5

HD Armor:7
LA Armor:6
RA Armor:6
LT Armor:8
RT Armor:8
CT Armor:11
LL Armor:8
RL Armor:8
LTR Armor:4
RTR Armor:4
CTR Armor:6

Weapons:0`;

      const result = parseMTF(mtf);
      expect(result.chassis).toBe('Jenner');
      expect(result.model).toBe('JR7-D');
      expect(result.mass).toBe(35);
      expect(result.walkMP).toBe(7);
      expect(result.jumpMP).toBe(5);
      expect(result.armor.centerTorso.front).toBe(11);
      expect(result.armor.centerTorso.rear).toBe(6);
    });
  });
});

describe('unitConverter', () => {
  describe('convertToMechDef', () => {
    it('converts parsed MTF to mech definition', () => {
      const parsed = parseMTF(atlasMTF);
      const mechDef = convertToMechDef(parsed);

      expect(mechDef.id).toBe('atlas-as7-d');
      expect(mechDef.name).toBe('Atlas AS7-D');
      expect(mechDef.tonnage).toBe(100);
      expect(mechDef.movement.walk).toBe(3);
      expect(mechDef.movement.run).toBe(4);
      expect(mechDef.movement.jump).toBe(0);
    });

    it('generates internal structure', () => {
      const parsed = parseMTF(atlasMTF);
      const mechDef = convertToMechDef(parsed);

      expect(mechDef.internalStructure.head).toBe(3);
      expect(mechDef.internalStructure.centerTorso).toBeGreaterThan(0);
      expect(mechDef.internalStructure.leftArm).toBeGreaterThan(0);
    });

    it('converts armor correctly', () => {
      const parsed = parseMTF(atlasMTF);
      const mechDef = convertToMechDef(parsed);

      expect(mechDef.armor.head.front).toBe(9);
      expect(mechDef.armor.centerTorso.front).toBe(47);
    });

    it('maps weapon names to IDs in critical slots', () => {
      const parsed = parseMTF(atlasMTF);
      const mechDef = convertToMechDef(parsed);

      const rtSlots = mechDef.criticalSlots.rightTorso;
      expect(rtSlots[0].item).toBe('ac20');

      const raSlots = mechDef.criticalSlots.rightArm;
      expect(raSlots[4].item).toBe('med_laser');
      expect(raSlots[8].item).toBe('machinegun');
    });

    it('maps ammo names to IDs in critical slots', () => {
      const parsed = parseMTF(atlasMTF);
      const mechDef = convertToMechDef(parsed);

      const rtSlots = mechDef.criticalSlots.rightTorso;
      expect(rtSlots[10].item).toBe('ac20_ammo');
    });

    it('maps empty and fixed equipment', () => {
      const parsed = parseMTF(atlasMTF);
      const mechDef = convertToMechDef(parsed);

      const head = mechDef.criticalSlots.head;
      expect(head[0].item).toBe('life_support');
      expect(head[1].item).toBe('sensors');
      expect(head[2].item).toBe('cockpit');
      expect(head[5].item).toBe('life_support');
    });

    it('maps actuators in arms', () => {
      const parsed = parseMTF(atlasMTF);
      const mechDef = convertToMechDef(parsed);

      const la = mechDef.criticalSlots.leftArm;
      expect(la[0].item).toBe('shoulder');
      expect(la[1].item).toBe('upper_arm_actuator');
      expect(la[2].item).toBe('lower_arm_actuator');
      expect(la[3].item).toBe('hand_actuator');
    });

    it('builds equipment weapons list from critical slots', () => {
      const parsed = parseMTF(atlasMTF);
      const mechDef = convertToMechDef(parsed);

      expect(mechDef.equipment.weapons.length).toBeGreaterThan(0);
      const ac20 = mechDef.equipment.weapons.find(w => w.type === 'ac20');
      expect(ac20).toBeDefined();
      expect(ac20.location).toBe('rightTorso');
    });

    it('builds equipment ammo from critical slots with correct shots', () => {
      const parsed = parseMTF(atlasMTF);
      const mechDef = convertToMechDef(parsed);

      expect(mechDef.equipment.ammo.ac20_ammo).toBeDefined();
      expect(mechDef.equipment.ammo.ac20_ammo.type).toBe('ac20');
      expect(mechDef.equipment.ammo.ac20_ammo.shots).toBe(15);
      expect(mechDef.equipment.ammo.ac20_ammo.explosive).toBe(true);

      expect(mechDef.equipment.ammo.srm6_ammo).toBeDefined();
      expect(mechDef.equipment.ammo.srm6_ammo.shots).toBe(30);

      expect(mechDef.equipment.ammo.lrm20_ammo).toBeDefined();
      expect(mechDef.equipment.ammo.lrm20_ammo.shots).toBe(12);
    });

    it('includes engine and gyro in definition', () => {
      const parsed = parseMTF(atlasMTF);
      const mechDef = convertToMechDef(parsed);

      expect(mechDef.engine.type).toBe('standard');
      expect(mechDef.engine.rating).toBe(300);
      expect(mechDef.engine.hits).toBe(0);
      expect(mechDef.gyro.type).toBe('standard');
      expect(mechDef.gyro.hits).toBe(0);
    });

    it('includes heat sink extras from critical slots', () => {
      const parsed = parseMTF(atlasMTF);
      const mechDef = convertToMechDef(parsed);

      expect(mechDef.heatSinks.count).toBe(20);
      expect(mechDef.heatSinks.type).toBe('single');
      expect(mechDef.heatSinks.damaged).toBe(0);
    });
  });

  describe('parseAndConvert', () => {
    it('converts MTF text directly to mech definition', () => {
      const mechDef = parseAndConvert(atlasMTF);

      expect(mechDef.id).toBe('atlas-as7-d');
      expect(mechDef.tonnage).toBe(100);
      expect(mechDef.equipment.weapons.length).toBeGreaterThan(0);
      expect(mechDef.criticalSlots.head).toBeDefined();
    });
  });

  describe('weapon name mapping', () => {
    it('maps standard weapons', () => {
      const mtf = `Chassis:Test
Model:TST-1
Mass:50
Engine:200 Fusion Engine
Heat Sinks:10 Single
Walk MP:4
Jump MP:0

HD Armor:9
LA Armor:10
RA Armor:10
LT Armor:10
RT Armor:10
CT Armor:10
LL Armor:10
RL Armor:10
RTL Armor:5
RTR Armor:5
CTR Armor:5

Weapons:0

Right Arm:
Medium Laser
PPC
Large Laser
AC/5
-Empty-
-Empty-
-Empty-
-Empty-

Left Arm:
SRM 6
LRM 20
Machine Gun
Flamer
-Empty-
-Empty-
-Empty-
-Empty-`;

      const mechDef = parseAndConvert(mtf);
      const ra = mechDef.criticalSlots.rightArm;
      expect(ra[0].item).toBe('med_laser');
      expect(ra[1].item).toBe('ppc');
      expect(ra[2].item).toBe('large_laser');
      expect(ra[3].item).toBe('ac5');

      const la = mechDef.criticalSlots.leftArm;
      expect(la[0].item).toBe('srm6');
      expect(la[1].item).toBe('lrm20');
      expect(la[2].item).toBe('machinegun');
      expect(la[3].item).toBe('flamer');
    });
  });
});
