import { describe, it, expect } from "vitest";
import { mechDefToMTF } from "../../src/export/mtfExporter.js";
import { parseMTF } from "../../src/import/mtfParser.js";
import { convertToMechDef, parseAndConvert } from "../../src/import/unitConverter.js";
import mechsData from "../../src/data/mechs.json" with { type: "json" };

/**
 * Count the critical-slot lines of one MTF location section (between its header
 * and the next blank line). Returns -1 when the section is missing.
 */
function sectionLineCount(mtf, header) {
  const lines = mtf.split("\n");
  const start = lines.indexOf(header);
  if (start < 0) return -1;

  let count = 0;
  for (let i = start + 1; i < lines.length && lines[i] !== ""; i++) count++;
  return count;
}

// Full Atlas MTF fixture for round-trip tests
const fullAtlasMTF = "Version:1.0\n" +
"generator:megameklab\n" +
"Chassis:Atlas\n" +
"Model:AS7-D\n" +
"mul id:6635\n" +
"Config:biped\n" +
"\n" +
"TechBase:Inner Sphere\n" +
"TechLevel:Standard\n" +
"Mass:100\n" +
"Engine:300 Fusion Engine\n" +
"cockpit:Standard cockpit\n" +
"Gyro:Standard Gyro\n" +
"Heat Sinks:20 Single\n" +
"Walk MP:3\n" +
"Jump MP:0\n" +
"\n" +
"Myomer:Standard\n" +
"Internal:Standard\n" +
"armor:Standard\n" +
"\n" +
"HD Armor:9\n" +
"LA Armor:34\n" +
"RA Armor:34\n" +
"LT Armor:32\n" +
"RT Armor:32\n" +
"CT Armor:47\n" +
"LL Armor:41\n" +
"RL Armor:41\n" +
"LTR Armor:10\n" +
"RTR Armor:10\n" +
"CTR Armor:14\n" +
"\n" +
"Weapons:15\n" +
"Medium Laser, RA\n" +
"Medium Laser, RA\n" +
"Medium Laser, RA\n" +
"Medium Laser, RA\n" +
"Medium Laser (R), CT\n" +
"Medium Laser (R), CT\n" +
"SRM 6, LT\n" +
"LRM 20, LT\n" +
"AC/20, RT\n" +
"Machine Gun, RA\n" +
"Machine Gun, RA\n" +
"Flamer, LA\n" +
"PPC, RT\n" +
"Large Laser, LA\n" +
"Small Laser, HD\n" +
"\n" +
"Left Arm:\n" +
"Shoulder\n" +
"Upper Arm\n" +
"Lower Arm\n" +
"Hand Actuator\n" +
"Large Laser\n" +
"Large Laser\n" +
"Flamer\n" +
"-Empty-\n" +
"-Empty-\n" +
"-Empty-\n" +
"-Empty-\n" +
"\n" +
"Right Arm:\n" +
"Shoulder\n" +
"Upper Arm\n" +
"Lower Arm\n" +
"Hand Actuator\n" +
"Medium Laser\n" +
"Medium Laser\n" +
"Medium Laser\n" +
"Medium Laser\n" +
"Machine Gun\n" +
"Machine Gun\n" +
"\n" +
"Left Torso:\n" +
"Heat Sink\n" +
"Heat Sink\n" +
"SRM 6\n" +
"SRM 6\n" +
"SRM 6 Ammo\n" +
"SRM 6 Ammo\n" +
"LRM 20 Ammo\n" +
"LRM 20 Ammo\n" +
"Jump Jet\n" +
"Jump Jet\n" +
"-Empty-\n" +
"-Empty-\n" +
"\n" +
"Right Torso:\n" +
"AC/20\n" +
"AC/20\n" +
"AC/20\n" +
"AC/20\n" +
"AC/20\n" +
"AC/20\n" +
"AC/20\n" +
"AC/20\n" +
"AC/20\n" +
"AC/20\n" +
"AC/20 Ammo\n" +
"AC/20 Ammo\n" +
"\n" +
"Center Torso:\n" +
"Engine\n" +
"Engine\n" +
"Engine\n" +
"Gyro\n" +
"Gyro\n" +
"Gyro\n" +
"Gyro\n" +
"Medium Laser (R)\n" +
"Medium Laser (R)\n" +
"AC/20 Ammo\n" +
"-Empty-\n" +
"-Empty-\n" +
"\n" +
"Head:\n" +
"Life Support\n" +
"Sensors\n" +
"Cockpit\n" +
"Small Laser\n" +
"Sensors\n" +
"Life Support\n" +
"\n" +
"Left Leg:\n" +
"Heat Sink\n" +
"Heat Sink\n" +
"-Empty-\n" +
"-Empty-\n" +
"-Empty-\n" +
"-Empty-\n" +
"\n" +
"Right Leg:\n" +
"Heat Sink\n" +
"Heat Sink\n" +
"-Empty-\n" +
"-Empty-\n" +
"-Empty-\n" +
"-Empty-\n" +
"\n" +
"Left Arm Actuators:Shoulder,Upper Arm,Lower Arm,Hand\n" +
"Right Arm Actuators:Shoulder,Upper Arm,Lower Arm,Hand";

function getMechDef(id) {
  return mechsData.mechs.find(m => m.id === id);
}

function createEmptyArmor() {
  return {
    head: { front: 0, rear: 0 },
    centerTorso: { front: 0, rear: 0 },
    leftTorso: { front: 0, rear: 0 },
    rightTorso: { front: 0, rear: 0 },
    leftArm: { front: 0, rear: 0 },
    rightArm: { front: 0, rear: 0 },
    leftLeg: { front: 0, rear: 0 },
    rightLeg: { front: 0, rear: 0 }
  };
}

function createEmptyStructure() {
  return {
    head: 3, centerTorso: 3, leftTorso: 3, rightTorso: 3,
    leftArm: 3, rightArm: 3, leftLeg: 3, rightLeg: 3
  };
}

function createEmptyCrits() {
  return {
    head: [], centerTorso: [], leftTorso: [], rightTorso: [],
    leftArm: [], rightArm: [], leftLeg: [], rightLeg: []
  };
}

describe("mechDefToMTF", () => {
  describe("header output", () => {
    it("outputs Version and generator lines", () => {
      const atlas = getMechDef("atlas-as7d");
      const mtf = mechDefToMTF(atlas);
      expect(mtf).toContain("Version:1.0");
      expect(mtf).toContain("generator:megameklab");
    });

    it("outputs chassis and model from name", () => {
      const atlas = getMechDef("atlas-as7d");
      const mtf = mechDefToMTF(atlas);
      expect(mtf).toContain("Chassis:Atlas");
      expect(mtf).toContain("Model:AS7-D");
    });

    it("splits multi-word chassis names correctly", () => {
      const sh = getMechDef("shadowhawk-shd2h");
      const mtf = mechDefToMTF(sh);
      expect(mtf).toContain("Chassis:Shadow Hawk");
      expect(mtf).toContain("Model:SHD-2H");
    });

    it("outputs Config:Biped", () => {
      const mtf = mechDefToMTF(getMechDef("atlas-as7d"));
      expect(mtf).toContain("Config:Biped");
    });

    it("outputs mass", () => {
      const mtf = mechDefToMTF(getMechDef("atlas-as7d"));
      expect(mtf).toContain("Mass:100");
    });

    it("outputs engine rating and type", () => {
      const mtf = mechDefToMTF(getMechDef("atlas-as7d"));
      expect(mtf).toContain("Engine:300 Fusion Engine");
    });

    it("maps XL engine type correctly", () => {
      const d = {
        id: "test", name: "Test TST-1", tonnage: 75,
        movement: { walk: 4, run: 6, jump: 0 },
        armor: createEmptyArmor(), internalStructure: createEmptyStructure(),
        criticalSlots: createEmptyCrits(),
        equipment: { weapons: [], ammo: {}, other: {} },
        heatSinks: { count: 10, type: "single", damaged: 0 },
        engine: { type: "xl", rating: 300, hits: 0 },
        gyro: { type: "standard", hits: 0 }
      };
      expect(mechDefToMTF(d)).toContain("Engine:300 XL Engine");
    });

    it("outputs gyro type", () => {
      const mtf = mechDefToMTF(getMechDef("atlas-as7d"));
      expect(mtf).toContain("Gyro:Standard Gyro");
    });

    it("outputs heat sink count and type (single)", () => {
      const mtf = mechDefToMTF(getMechDef("atlas-as7d"));
      expect(mtf).toMatch(/Heat Sinks:\d+ Single/);
    });

    it("outputs heat sink type (double)", () => {
      const d = {
        id: "test", name: "Test TST-1", tonnage: 50,
        movement: { walk: 4, run: 6, jump: 0 },
        armor: createEmptyArmor(), internalStructure: createEmptyStructure(),
        criticalSlots: createEmptyCrits(),
        equipment: { weapons: [], ammo: {}, other: {} },
        heatSinks: { count: 10, type: "double", damaged: 0 },
        engine: { type: "standard", rating: 200, hits: 0 },
        gyro: { type: "standard", hits: 0 }
      };
      expect(mechDefToMTF(d)).toMatch(/Heat Sinks:\d+ Double/);
    });

    it("outputs walk and jump MP", () => {
      const mtf = mechDefToMTF(getMechDef("jenner-jr7d"));
      expect(mtf).toContain("Walk MP:7");
      expect(mtf).toContain("Jump MP:5");
    });

    it("outputs TechBase and armor type", () => {
      const mtf = mechDefToMTF(getMechDef("atlas-as7d"));
      expect(mtf).toContain("TechBase:Inner Sphere");
      expect(mtf).toContain("armor:Standard");
    });
  });

  describe("armor output", () => {
    it("outputs all armor locations for Atlas", () => {
      const mtf = mechDefToMTF(getMechDef("atlas-as7d"));
      expect(mtf).toContain("HD Armor:9");
      expect(mtf).toContain("CT Armor:47");
      expect(mtf).toContain("CTR Armor:14");
      expect(mtf).toContain("LT Armor:32");
      expect(mtf).toContain("LTR Armor:10");
      expect(mtf).toContain("RT Armor:32");
      expect(mtf).toContain("RTR Armor:10");
      expect(mtf).toContain("LA Armor:34");
      expect(mtf).toContain("RA Armor:34");
      expect(mtf).toContain("LL Armor:41");
      expect(mtf).toContain("RL Armor:41");
    });

    it("omits rear armor when value is zero", () => {
      const d = {
        id: "test", name: "Test TST-1", tonnage: 50,
        movement: { walk: 4, run: 6, jump: 0 },
        armor: {
          head: { front: 9, rear: 0 }, centerTorso: { front: 20, rear: 0 },
          leftTorso: { front: 16, rear: 0 }, rightTorso: { front: 16, rear: 0 },
          leftArm: { front: 14, rear: 0 }, rightArm: { front: 14, rear: 0 },
          leftLeg: { front: 18, rear: 0 }, rightLeg: { front: 18, rear: 0 }
        },
        internalStructure: createEmptyStructure(), criticalSlots: createEmptyCrits(),
        equipment: { weapons: [], ammo: {}, other: {} },
        heatSinks: { count: 10, type: "single", damaged: 0 },
        engine: { type: "standard", rating: 200, hits: 0 },
        gyro: { type: "standard", hits: 0 }
      };
      const mtf = mechDefToMTF(d);
      expect(mtf).toContain("CT Armor:20");
      expect(mtf).not.toContain("CTR Armor:");
    });
  });

  describe("weapons list output", () => {
    it("counts weapons correctly", () => {
      const mtf = mechDefToMTF(getMechDef("atlas-as7d"));
      expect(mtf).toContain("Weapons:7");
    });

    it("outputs weapon names and location abbreviations", () => {
      const mtf = mechDefToMTF(getMechDef("atlas-as7d"));
      expect(mtf).toContain("AC/20, RT");
      expect(mtf).toContain("Medium Laser, RA");
      expect(mtf).toContain("SRM 6, LT");
      expect(mtf).toContain("LRM 20, LT");
    });

    it("marks rear-facing weapons with (R)", () => {
      const d = {
        id: "test", name: "Test TST-1", tonnage: 50,
        movement: { walk: 4, run: 6, jump: 0 },
        armor: createEmptyArmor(), internalStructure: createEmptyStructure(),
        criticalSlots: createEmptyCrits(),
        equipment: {
          weapons: [
            { type: "med_laser_rear", location: "centerTorso" },
            { type: "med_laser", location: "rightArm" }
          ],
          ammo: {}, other: {}
        },
        heatSinks: { count: 10, type: "single", damaged: 0 },
        engine: { type: "standard", rating: 200, hits: 0 },
        gyro: { type: "standard", hits: 0 }
      };
      const mtf = mechDefToMTF(d);
      expect(mtf).toContain("Medium Laser (R), CT");
      expect(mtf).toContain("Medium Laser, RA");
    });

    it("handles mechs with no weapons", () => {
      const d = {
        id: "test", name: "Test TST-1", tonnage: 50,
        movement: { walk: 4, run: 6, jump: 0 },
        armor: createEmptyArmor(), internalStructure: createEmptyStructure(),
        criticalSlots: createEmptyCrits(),
        equipment: { weapons: [], ammo: {}, other: {} },
        heatSinks: { count: 10, type: "single", damaged: 0 },
        engine: { type: "standard", rating: 200, hits: 0 },
        gyro: { type: "standard", hits: 0 }
      };
      expect(mechDefToMTF(d)).toContain("Weapons:0");
    });
  });

  describe("critical slot output", () => {
    it("outputs section headers for all 8 locations", () => {
      const mtf = mechDefToMTF(getMechDef("atlas-as7d"));
      expect(mtf).toContain("Head:");
      expect(mtf).toContain("Center Torso:");
      expect(mtf).toContain("Left Torso:");
      expect(mtf).toContain("Right Torso:");
      expect(mtf).toContain("Left Arm:");
      expect(mtf).toContain("Right Arm:");
      expect(mtf).toContain("Left Leg:");
      expect(mtf).toContain("Right Leg:");
    });

    it("maps internal item IDs to MTF display names", () => {
      const mtf = mechDefToMTF(getMechDef("atlas-as7d"));
      expect(mtf).toContain("Life Support");
      expect(mtf).toContain("Sensors");
      expect(mtf).toContain("Cockpit");
      expect(mtf).toContain("Engine");
      expect(mtf).toContain("Gyro");
      expect(mtf).toContain("AC/20");
      expect(mtf).toContain("Medium Laser");
      expect(mtf).toContain("AC/20 Ammo");
      expect(mtf).toContain("SRM 6 Ammo");
      expect(mtf).toContain("LRM 20 Ammo");
      expect(mtf).toContain("Heat Sink");
    });

    it("uses -Empty- for empty slots", () => {
      expect(mechDefToMTF(getMechDef("atlas-as7d"))).toContain("-Empty-");
    });

    it("pads critical slots to the p6 count for each location", () => {
      const d = {
        id: "test", name: "Test TST-1", tonnage: 20,
        movement: { walk: 8, run: 12, jump: 0 },
        armor: createEmptyArmor(), internalStructure: createEmptyStructure(),
        criticalSlots: {
          head: [{ slot: 1, item: "life_support", status: "ok" }],
          centerTorso: [], leftTorso: [], rightTorso: [],
          leftArm: [], rightArm: [], leftLeg: [], rightLeg: []
        },
        equipment: { weapons: [], ammo: {}, other: {} },
        heatSinks: { count: 10, type: "single", damaged: 0 },
        engine: { type: "standard", rating: 160, hits: 0 },
        gyro: { type: "standard", hits: 0 }
      };
      const mtf = mechDefToMTF(d);

      // p6 SLOT: "six in the head and legs, twelve in other locations" - arms
      // are other locations, so they get 12 lines, not 10.
      expect(sectionLineCount(mtf, "Head:"), "head").toBe(6);
      expect(sectionLineCount(mtf, "Center Torso:"), "center torso").toBe(12);
      expect(sectionLineCount(mtf, "Left Torso:"), "left torso").toBe(12);
      expect(sectionLineCount(mtf, "Right Torso:"), "right torso").toBe(12);
      expect(sectionLineCount(mtf, "Left Arm:"), "left arm").toBe(12);
      expect(sectionLineCount(mtf, "Right Arm:"), "right arm").toBe(12);
      expect(sectionLineCount(mtf, "Left Leg:"), "left leg").toBe(6);
      expect(sectionLineCount(mtf, "Right Leg:"), "right leg").toBe(6);
    });
  });

  describe("actuator lines", () => {
    it("outputs actuator lines when actuators are present in crits", () => {
      const d = {
        id: "test", name: "Test TST-1", tonnage: 50,
        movement: { walk: 4, run: 6, jump: 0 },
        armor: createEmptyArmor(), internalStructure: createEmptyStructure(),
        criticalSlots: {
          head: [], centerTorso: [], leftTorso: [], rightTorso: [],
          leftArm: [
            { slot: 1, item: "shoulder", status: "ok" },
            { slot: 2, item: "upper_arm_actuator", status: "ok" },
            { slot: 3, item: "lower_arm_actuator", status: "ok" },
            { slot: 4, item: "hand_actuator", status: "ok" },
            { slot: 5, item: "empty", status: "ok" }
          ],
          rightArm: [], leftLeg: [], rightLeg: []
        },
        equipment: { weapons: [], ammo: {}, other: {} },
        heatSinks: { count: 10, type: "single", damaged: 0 },
        engine: { type: "standard", rating: 200, hits: 0 },
        gyro: { type: "standard", hits: 0 }
      };
      expect(mechDefToMTF(d)).toContain("Left Arm Actuators:");
    });

    it("exports actuator lines for a roster Mech", () => {
      const mtf = mechDefToMTF(getMechDef("atlas-as7d"));
      expect(mtf).toContain("Left Arm Actuators:Shoulder,Upper Arm,Lower Arm,Hand");
      expect(mtf).toContain("Right Arm Actuators:Shoulder,Upper Arm,Lower Arm,Hand");
      expect(mtf).toContain("Left Leg Actuators:Hip,Upper Leg,Lower Leg,Foot");
      expect(mtf).toContain("Right Leg Actuators:Hip,Upper Leg,Lower Leg,Foot");
    });
  });

  describe("round-trip via import pipeline", () => {
    it("preserves name, tonnage, and movement", () => {
      const atlas = getMechDef("atlas-as7d");
      const mtf = mechDefToMTF(atlas);
      const reimported = parseAndConvert(mtf);

      expect(reimported.id).toBe("atlas-as7-d");
      expect(reimported.name).toBe("Atlas AS7-D");
      expect(reimported.tonnage).toBe(100);
      expect(reimported.movement.walk).toBe(3);
      expect(reimported.movement.jump).toBe(0);
    });

    it("preserves armor values on round-trip", () => {
      const atlas = getMechDef("atlas-as7d");
      const mtf = mechDefToMTF(atlas);
      const reimported = parseAndConvert(mtf);

      expect(reimported.armor.head.front).toBe(9);
      expect(reimported.armor.centerTorso.front).toBe(47);
      expect(reimported.armor.centerTorso.rear).toBe(14);
    });

    it("preserves engine and gyro on round-trip", () => {
      const atlas = getMechDef("atlas-as7d");
      const mtf = mechDefToMTF(atlas);
      const reimported = parseAndConvert(mtf);

      expect(reimported.engine.type).toBe("standard");
      expect(reimported.engine.rating).toBe(300);
      expect(reimported.gyro.type).toBe("standard");
    });

    it("round-trips 12 arm slots and 6 leg slots for the Atlas", () => {
      const mtf = mechDefToMTF(getMechDef("atlas-as7d"));

      // p6 SLOT: head and legs have six lines; every other location (incl. the
      // arms) has twelve.
      expect(sectionLineCount(mtf, "Left Arm:"), "left arm").toBe(12);
      expect(sectionLineCount(mtf, "Right Arm:"), "right arm").toBe(12);
      expect(sectionLineCount(mtf, "Left Leg:"), "left leg").toBe(6);
      expect(sectionLineCount(mtf, "Right Leg:"), "right leg").toBe(6);

      const parsed = parseMTF(mtf);
      expect(parsed.criticalSlots.leftArm).toHaveLength(12);
      expect(parsed.criticalSlots.rightArm).toHaveLength(12);
      expect(parsed.criticalSlots.leftLeg).toHaveLength(6);
      expect(parsed.criticalSlots.rightLeg).toHaveLength(6);
    });

    it("produces parseable MTF for all mechs in mechs.json", () => {
      for (const mechDef of mechsData.mechs) {
        const mtf = mechDefToMTF(mechDef);
        const parsed = parseMTF(mtf);
        expect(parsed.mass).toBe(mechDef.tonnage);
        expect(parsed.walkMP).toBe(mechDef.movement.walk);
        expect(parsed.jumpMP).toBe(mechDef.movement.jump);
      }
    });

    it("round-trips the original MTF fixture through import->export->import", () => {
      const parsed1 = parseMTF(fullAtlasMTF);
      const mechDef1 = convertToMechDef(parsed1);
      const mtf = mechDefToMTF(mechDef1);
      const parsed2 = parseMTF(mtf);

      expect(parsed2.chassis).toBe(parsed1.chassis);
      expect(parsed2.model).toBe(parsed1.model);
      expect(parsed2.mass).toBe(parsed1.mass);
      expect(parsed2.walkMP).toBe(parsed1.walkMP);
      expect(parsed2.jumpMP).toBe(parsed1.jumpMP);
      expect(parsed2.engine.rating).toBe(parsed1.engine.rating);
      expect(parsed2.engine.type).toBe(parsed1.engine.type);
      expect(parsed2.gyro.type).toBe(parsed1.gyro.type);
      expect(parsed2.armor.head.front).toBe(parsed1.armor.head.front);
      expect(parsed2.armor.centerTorso.front).toBe(parsed1.armor.centerTorso.front);
      expect(parsed2.armor.centerTorso.rear).toBe(parsed1.armor.centerTorso.rear);
    });
  });

  describe("edge cases", () => {
    it("handles mech with no model in name gracefully", () => {
      const d = {
        id: "test", name: "Test", tonnage: 50,
        movement: { walk: 4, run: 6, jump: 0 },
        armor: createEmptyArmor(), internalStructure: createEmptyStructure(),
        criticalSlots: createEmptyCrits(),
        equipment: { weapons: [], ammo: {}, other: {} },
        heatSinks: { count: 10, type: "single", damaged: 0 },
        engine: { type: "standard", rating: 200, hits: 0 },
        gyro: { type: "standard", hits: 0 }
      };
      const mtf = mechDefToMTF(d);
      expect(mtf).toContain("Chassis:Test");
      expect(mtf).toContain("Model:");
    });

    it("handles missing critical slots gracefully", () => {
      const d = {
        id: "test", name: "Test TST-1", tonnage: 50,
        movement: { walk: 4, run: 6, jump: 0 },
        armor: createEmptyArmor(), internalStructure: createEmptyStructure(),
        criticalSlots: {},
        equipment: { weapons: [], ammo: {}, other: {} },
        heatSinks: { count: 10, type: "single", damaged: 0 },
        engine: { type: "standard", rating: 200, hits: 0 },
        gyro: { type: "standard", hits: 0 }
      };
      const mtf = mechDefToMTF(d);
      expect(mtf).toContain("Head:");
      expect(mtf).toContain("Center Torso:");
    });

    it("handles unknown item IDs via fallback formatting", () => {
      const d = {
        id: "test", name: "Test TST-1", tonnage: 50,
        movement: { walk: 4, run: 6, jump: 0 },
        armor: createEmptyArmor(), internalStructure: createEmptyStructure(),
        criticalSlots: {
          head: [
            { slot: 1, item: "some_unknown_item", status: "ok" },
            { slot: 2, item: "another_thing_here", status: "ok" }
          ],
          centerTorso: [], leftTorso: [], rightTorso: [],
          leftArm: [], rightArm: [], leftLeg: [], rightLeg: []
        },
        equipment: { weapons: [], ammo: {}, other: {} },
        heatSinks: { count: 10, type: "single", damaged: 0 },
        engine: { type: "standard", rating: 200, hits: 0 },
        gyro: { type: "standard", hits: 0 }
      };
      const mtf = mechDefToMTF(d);
      expect(mtf).toContain("Some Unknown Item");
      expect(mtf).toContain("Another Thing Here");
    });

    it("produces output starting with Version:1.0", () => {
      const mtf = mechDefToMTF(getMechDef("atlas-as7d"));
      expect(mtf.split("\n")[0]).toBe("Version:1.0");
    });

    it("round-trips a lightweight mech (Locust)", () => {
      const mtf = mechDefToMTF(getMechDef("locust-lct1v"));
      const parsed = parseMTF(mtf);
      expect(parsed.mass).toBe(20);
      expect(parsed.walkMP).toBe(8);
      expect(parsed.jumpMP).toBe(0);
      expect(parsed.armor.head.front).toBe(8);
    });

    it("round-trips a fast jumping mech (Jenner)", () => {
      const mtf = mechDefToMTF(getMechDef("jenner-jr7d"));
      const parsed = parseMTF(mtf);
      expect(parsed.mass).toBe(35);
      expect(parsed.walkMP).toBe(7);
      expect(parsed.jumpMP).toBe(5);
    });
  });
});
