# t6 — Audit: game data, import and export fidelity

Auditor: audit-data (attempt 1, attempt 9a4b20d2-e240-47b5-ad4d-8971082db211)
Task: t6 — READ-ONLY data / import-export audit against the BattleMech Manual via the knowledge base.
Sources used: KB chunks for BMM pp. 6–8, 17, 22, 44, 46–52, 54, 60–61, 66–67, 114–117, 120–127, 136–137,
139–142, 145; `src/data/*.json`, `src/data/maps/*.json`, `src/import/*.js`, `src/export/mtfExporter.js`;
existing tests. No code was edited, no tests were run, no git commands were used.

KB note: the KB stores page-level chunks, so individual table rows are quoted only where the chunk
actually contains them. Two table regions are **not** present in any chunk: the SRM launcher rows of
the Inner Sphere Weapons table (p121 chunk ends at "Medium Pulse Laser"; the p122 chunk resumes at
"Pulse Weapons (continued)"), and the ECM suite rows of the equipment tables (p126/p127 chunks list
Artemis/C3/Targeting Computer but no ECM line). Those rows are treated as unverifiable below.

---

## A. Findings (ranked)

Severity scale: blocker / high / medium / low.

---

### D-01 — `small_laser` is used by four roster units but does not exist in `weapons.json`

* **Severity:** high
* **File:line:** `src/data/mechs.json:4182, 4239, 4561, 4565` (Warhammer WHM-6D), `:5839, 6290`
  (Banshee BNC-3E), `:6400, 6854` (Awesome AWS-8Q), `:7568, 8019` (Banshee refit) —
  `src/data/weapons.json` (no `small_laser` entry; 17 weapons listed, lines 2–258).
* **Manual (p121, Inner Sphere Weapons):** `Small Laser DE 1 3 0 1 2 3 0.5 1 — 100`
  (Heat 1, Damage 3, Minimum 0, Short 1, Medium 2, Long 3, 0.5 tons, 1 crit).
* **Code behaviour:** `src/main.js:326` does `weaponsLookup[weaponType]`, which is `undefined` for
  `small_laser`; the action is handed to `GameEngine.resolveWeaponAttack`
  (`src/engine/GameEngine.js:429`), which dereferences it at `:464` (`weaponDef.usesAmmo()`) and at
  `:496` (`weaponDef.heat`). Selecting either small laser in the weapon panel throws a TypeError —
  the Warhammer, Banshee and Awesome cannot fire those weapons, and there is no fallback stats path.
* **Pinning test:** none. `tests/data/mechs.test.js:156-173` only checks that `ammoBin` references
  resolve; nothing asserts that `equipment.weapons[].type` exists in `weapons.json`.
* **Recommended fix:** add `small_laser` (`type:"DE"`, heat 1, damage 3, min 0, 1/2/3, 1 crit,
  0.5 t) to `weapons.json`, and add a data-integrity test that every weapon id used by any mech
  resolves in `weapons.json` (the same test would have caught D-02).

---

### D-02 — Atlas AS7-D lists an SRM-6 that has no critical slot anywhere

* **Severity:** high
* **File:line:** `src/data/mechs.json:547-551` (weapon `srm6` @ `leftTorso`, `ammoBin: srm6_ammo`);
  the `leftTorso` critical section for both Atlas entries holds only `lrm20` ×5, `lrm20_ammo` ×2 and
  `heat_sink` ×5 (12 slots). `"item": "srm6"` never appears in either Atlas entry — only
  `"item": "srm6_ammo"` at `:137` and `:142` (and `:7021`/`:7026` for the refit).
* **Manual (p6, SLOT):** "Slots are where the weapons, equipment, and structural components that make
  up a ’Mech are placed. When critical hits are assigned, they are assigned to specific slots,
  disabling or even potentially exploding whatever is in that slot". Also p49 "Weapons And
  Equipment: A critical hit … to any slot of an item destroys that item."
* **Code behaviour:** `Unit.getWeaponsByLocation()` (`src/models/Unit.js:197`) reads
  `equipment.weapons`, so the SRM-6 fires normally, but `DamageResolver` only ever destroys items
  found in `criticalSlots` — the launcher can never take a critical hit in its own location, and
  "the ’Mech lost all its weapons" checks that walk critical slots will not see it.
* **Pinning test:** none. `tests/data/mechs.test.js` checks slot counts and ammo references, never
  that each listed weapon has at least one matching crit slot.
* **Recommended fix:** place the SRM-6 in a free critical slot (and rebalance the heat sinks) or
  remove it from `equipment.weapons`; add the reverse-integrity test described in D-01.

---

### D-03 — the left and right hit-location columns are wrong (left is a copy of front; right is its mirror)

* **Severity:** high (data), currently latent
* **File:line:** `src/data/hitTables.json:39-74` (`hitLocation.left`) and `:75-110`
  (`hitLocation.right`).
* **Manual (p139, ’Mech Hit Location Table):**
  "Roll(2D6) Biped … Left Side | Front/Rear | Right Side
  2* Left Torso [critical] | Center Torso [critical] | Right Torso [critical]
  3 Left Leg | Right Arm | Right Leg
  4 Left Arm | Right Arm | Right Arm
  5 Left Arm | Right Leg | Right Arm
  6 Left Leg | Right Torso | Right Leg
  7 Left Torso | Center Torso | Right Torso
  8 Center Torso | Left Torso | Center Torso
  9 Right Torso | Left Leg | Left Torso
  10 Right Arm | Left Arm | Left Arm
  11 Right Leg | Left Arm | Left Leg
  12 Head | Head | Head"
* **Code behaviour:** `left` is byte-for-byte the `front` column (3=rightArm, 4=rightArm, 5=rightLeg,
  6=rightTorso, 7=centerTorso, 8=leftTorso, 9=leftLeg, 10=leftArm, 11=leftArm, 2=centerTorso), where
  the manual's left column is 3=leftLeg, 4=leftArm, 5=leftArm, 6=leftLeg, 7=leftTorso, 8=centerTorso,
  9=rightTorso, 10=rightArm, 11=rightLeg, 2=leftTorso. `right` is the mirror of that same wrong table.
  `GameEngine` currently only ever calls `attackResolver.determineHitLocation(roll, 'front')`
  (`src/engine/GameEngine.js:834, 996, 1018, 1052`), so the wrong columns are unreachable today —
  the moment attack direction is wired up, every side-arc hit lands on the wrong side of the target.
* **Pinning tests (assert the wrong data):** `tests/rules/combat/HitTables.test.js:74-107` (left) and
  `:110-143` (right) spell out the wrong rows as expectations; `:165-179` additionally asserts the two
  tables are mirror images, so fixing one side alone fails the suite. `:98-107` even derives a
  "balanced" probability of 14/36 from the wrong table.
* **Recommended fix:** replace both columns with the p139 rows (including 2 = own-side torso), and
  rewrite the HitTables tests to assert the manual rows rather than the data file's contents.

---

### D-04 — punch and kick location tables are 2D6 tables with non-manual values (manual: 1D6, three columns)

* **Severity:** high (rules correctness of every physical attack)
* **File:line:** `src/data/hitTables.json:157-191` (`hitLocation.punch`), `:192-226`
  (`hitLocation.kick`).
* **Manual (p140, ’Mech Punch Location Table):** "Roll(1D6) Left Side | Front/Rear | Right Side
  1 Left Torso | Left Arm | Right Torso; 2 Left Torso | Left Torso | Right Torso;
  3 Center Torso | Center Torso | Center Torso; 4 Left Arm | Right Torso | Right Arm;
  5 Left Arm | Right Arm | Right Arm; 6 Head | Head | Head".
  Manual (p139/p140, ’Mech Kick Location Table): "Roll(1D6) … 1–3 Left Leg | Right Leg | Right Leg;
  4–6 Left Leg | Left Leg | Right Leg".
* **Code behaviour:** the punch table is keyed 2–12 with 2=head, 3=rightArm, 4=rightArm,
  5=rightTorso, 6=rightTorso, 7=centerTorso, 8=leftTorso, 9=leftTorso, 10=leftArm, 11=leftArm,
  12=head; the kick table alternates legs across 2–12. `PhysicalAttackResolver` rolls 2D6 for the
  location (`src/rules/combat/PhysicalAttackResolver.js:264, 315, 362, 404, 517`) and then indexes
  these tables, so the result distribution is materially different from the manual: head 2/36
  (5.6 %) instead of 1/6 (16.7 %); left/right arm 3/36 (8.3 %) instead of 1/6 each; the two side
  torsos take 9/36 each (25 %) instead of 1/6 (16.7 %). Kicks are 50/50 legs for a front/rear
  attack (which matches the manual in outcome) but the side columns — where the manual forces the
  near leg — do not exist.
* **Pinning tests (self-referential):** `tests/rules/combat/PhysicalAttackResolver.test.js:41-53`
  copies `hitLocation.punch` into `EXPECTED_PUNCH` and asserts equality; `:59-71` does the same for
  kicks. The tests can never detect a manual mismatch because the expectation is the data file.
* **Recommended fix:** store 1D6 tables with `left`/`front`/`right` columns (kick 1–3/4–6 ranges),
  roll 1D6 in the resolver, and write the expectations from the manual text (p140).

---

### D-05 — ammo `shots` is stored per ton while the crit table can hold several bins of the same id

* **Severity:** medium-high (ammo explosion damage and ammo expenditure)
* **File:line:** `src/data/mechs.json`:
  Atlas `srm6_ammo` occupies 2 crit slots (`:137`, `:142`) but the bin holds `shots: 15` (`:566`);
  Atlas `lrm20_ammo` 2 slots / `shots: 6` (`:571`); Thunderbolt `lrm15_ammo` 2 slots / `shots: 8`
  (`:2299`); Griffin `lrm10_ammo` 2 slots / `shots: 12` (`:4000`); Stalker `lrm10_ammo` 3 slots /
  `shots: 12` (`:5736`) and `srm6_ammo` 2 slots / `shots: 15` (`:5731`).
* **Manual (p52, AMMUNITION):** "All of the appropriate ammo type in a single critical slot explodes.
  If more than one critical hit slot holds the appropriate ammo type, the one with the most shots
  remaining explodes." And p47: "a critical hit to its ammunition bin deals the weapon’s damage
  times the number of shots left in that bin". I.e. each crit slot is its own bin.
* **Code behaviour:** the import pipeline agrees with the manual's per-slot model —
  `src/import/unitConverter.js:270-278` sums `ammoShotsPerTon[type]` once per crit slot, so the same
  Atlas MTF imports as 30 SRM shots / 12 LRM shots (`tests/import/mtfParser.test.js:415-429` pins
  exactly those totals). The roster data instead stores one ton in `shots`, so it disagrees with its
  own critical-slot layout by a factor equal to the bin count. `DamageResolver.resolveAmmoExplosion`
  (`src/rules/combat/DamageResolver.js:185-186`) explodes `ammo.shots × damage` and then zeroes the
  single id — i.e. one explosion writes off every slot of that ammo type at once, contrary to p52.
* **Pinning test:** `tests/data/mechs.test.js:162-173` only asserts `shots > 0`; the import test pins
  the per-slot arithmetic. Nothing reconciles the two conventions.
* **Recommended fix:** key ammo per slot (e.g. `ammo: { id__loc_slot: { type, shots } }`) and have
  the resolver explode the largest surviving bin; at minimum, make roster `shots` equal
  `shotsPerTon × binCount` and document the change.

---

### D-06 — MTF export writes `Heat Sinks:<total − crit sinks>`, so a round trip halves dissipation

* **Severity:** medium-high (export fidelity)
* **File:line:** `src/export/mtfExporter.js:314-315`:
  `const critHS = countCritHeatSinks(mechDef.criticalSlots);`
  `const headerHS = Math.max(10, mechDef.heatSinks.count - critHS);`
  then `"Heat Sinks:" + headerHS + " " + hsType` at `:328`.
* **Manual/data basis:** the MTF field is the ’Mech's total heat-sink count — the repo's own importer
  proves it: `src/import/mtfParser.js:264-268` sets `heatSinks.count = <header value>`, and
  `tests/import/mtfParser.test.js:175-179` asserts the fixture's `Heat Sinks:20 Single` parses to 20.
  The manual's Heat Point Table (p50) is per operational sink: "Heat sink –1 per operational heat
  sink; –2 per operational double heat sink".
* **Code behaviour:** roster Atlas (20 sinks, 10 of them in crit slots) exports
  `Heat Sinks:10 Single`; re-importing gives 10 sinks, i.e. half the dissipation and an illegal
  design where no sink sits in the engine. Round-tripping the suite's own `fullAtlasMTF`
  (20 total, 6 in crits) yields 14, not 20.
* **Pinning test:** none. `tests/export/mtfExporter.test.js:241-258` only regexes
  `/Heat Sinks:\d+ Single/`; the round-trip block `:456-515` never asserts `heatSinks`.
* **Recommended fix:** write `mechDef.heatSinks.count`; add round-trip assertions for count and type.

---

### D-07 — MTF exporter critical-slot padding: arms 10 lines (should be 12)

* **Severity:** medium (exported files are malformed for any external reader)
* **File:line:** `src/export/mtfExporter.js:208-217` —
  `CRIT_SLOT_COUNTS = { head: 6, centerTorso: 12, leftTorso: 12, rightTorso: 12, leftArm: 10,
  rightArm: 10, leftLeg: 6, rightLeg: 6 }`.
* **Manual (p6, SLOT):** "each line within a location (six in the head and legs, twelve in other
  locations) is referred to as a “slot”". Read literally, arms are "other locations" → 12 lines; the
  exporter emits 10, so any arm with fewer than 10 items is padded two lines short. The legs (6) match
  the literal text but conflict with the record sheets this project actually uses
  (`mechs.json` gives every location 12 slots and `tests/data/mechs.test.js:128-132` asserts 12 for
  limbs), so the KB quote looks like a PDF-extraction artefact for the legs and should be re-checked
  against a printed record sheet.
* **Code behaviour:** `buildCriticalSections()` (`:393-420`) pads any location with fewer entries to
  `CRIT_SLOT_COUNTS[location]`; the repo's MTF fixtures were written to the same numbers
  (`tests/import/mtfParser.test.js:56-67` gives a 10-line arm, `:131-145` a 6-line leg), so the defect
  is invisible inside the repo and only bites when a real MTF tool reads the output.
* **Pinning test:** `tests/export/mtfExporter.test.js:394-418` asserts head padding only
  (5 empties after 1 item = 6) — correct per p6 — but nothing asserts arm/leg counts.
* **Recommended fix:** use 12 for arms and legs (6 for head only) and add a test that every exported
  location has the record-sheet line count.

---

### D-08 — MTF import silently drops cockpit, structure, armour and TSM/MASC header fields

* **Severity:** medium
* **File:line:** `src/import/mtfParser.js:309-323` (the returned object carries only config, chassis,
  model, mass, walkMP, jumpMP, engine, heatSinks, gyro, armor, weaponsList, criticalSlots,
  rawHeader).
* **Manual:** p115 Cockpit Systems ("Small … Torso-Mounted"), with effects at p47 (torso-mounted
  cockpit head damage), p52 (MW heat damage "between 1 and 14 … 15 or higher") and p142
  ("’Mech mounts small or torso-mounted cockpit +1"); p114 "Critical Hit: Slots allocated to armor
  are inapplicable slots"; p126 "Ferro-Fibrous — 14" critical slots; p126 "Triple-Strength Myomer 0 6"
  (0 tons, 6 crits). All of these change play.
* **Code behaviour:** a MTF containing `cockpit:Torso-Mounted Cockpit`, `Internal:Endo Steel`,
  `armor:Ferro-Fibrous`, `TSM:` or `MASC:` imports as a standard-cockpit, standard-structure,
  standard-armour ’Mech with no equipment flags. The repo's own fixture contains
  `cockpit:Standard cockpit`, `Myomer:Standard`, `Internal:Standard`
  (`tests/import/mtfParser.test.js:17, 20-21`) — all parsed into `rawHeader` and then discarded.
* **Pinning test:** none (no test asserts any of these fields survive).
* **Recommended fix:** parse and carry `Cockpit:`, `Internal:`/`Structure:`, `Armor:`, `TSM:`/`MASC:`
  and warn on unsupported combinations; assert round-trip preservation for at least cockpit type.

---

### D-09 — rear-mounted weapons are detected only in the *name*, so `Medium Laser,CT (R)` imports with no location

* **Severity:** medium
* **File:line:** `src/import/mtfParser.js:137-143`
  (`const location = LOCATION_ABBREV[locAbbrev] || null; const rear = name.toLowerCase().includes('(r)');`).
* **Manual:** p24 (rear firing arc / reversing arms) and p139: rear-mounted weapons are marked "(R)"
  and fire into the rear arc — losing the flag silently converts a rear laser into a forward one.
* **Code behaviour:** the repo's convention puts "(R)" in the name (`Medium Laser (R), CT`, see
  `tests/import/mtfParser.test.js:44` and `src/export/mtfExporter.js:376-378`), which round-trips.
  A file that marks the mount on the location side (`Medium Laser, CT (R)` / `CTR`) yields
  `location: null` and `rear: false`; `unitConverter` then pushes the weapon with `location: null`,
  which drops it out of `getWeaponsByLocation()` and out of arc checks.
* **Pinning test:** `tests/import/mtfParser.test.js:211` asserts the repo's own "(R)-in-name"
  convention, i.e. it pins the internal format rather than tolerating both. The MTF grammar itself
  is not documented in the BMM (see §C).
* **Recommended fix:** strip a trailing `(R)` from either the name or the location, and accept
  `CTR`/`LTR`/`RTR` location keys as rear mounts; add a fixture with the "(R)" after the location.

---

### D-10 — armour parser aborts on an unknown key (`RTL Armor:`) and loses rear torso armour

* **Severity:** medium
* **File:line:** `src/import/mtfParser.js:82` (regex `^(HD|CTR?|RTR?|LTR?|RA|LA|RL|LL)\s+Armor:`),
  `:88` (`if (!match) break;`), `:98-102` (rear set `{CTR, RTR, LTR}`).
* **Code behaviour:** `RTL Armor:5` does not match, so the loop `break`s and every following armour
  line is discarded. The repo's own fixture exercises exactly this shape at
  `tests/import/mtfParser.test.js:481-483` (`RTL Armor:5 / RTR Armor:5 / CTR Armor:5`) — RTL is
  dropped and nothing asserts the rear values, so the loss is invisible. Depending on line order the
  same bug can also drop front armour or a whole torso.
* **Manual:** p8 "The Armor Diagram also shows the front and rear armor of the ’Mech’s three torso
  locations"; p6 Armor Value — losing rear armour silently weakens the ’Mech.
* **Pinning test:** `tests/import/mtfParser.test.js:452-460` only asserts id/tonnage/weapons after
  that fixture; no armour assertion.
* **Recommended fix:** accept `RTL`/`RTR`/`CTR` alongside `LTR`/`RTR`/`CTR`, and `continue` with a
  warning instead of `break` on an unrecognised line.

---

### D-11 — Running MP is floored in the import path (manual: ×1.5 rounded **up**)

* **Severity:** medium
* **File:line:** `src/import/unitConverter.js:198-202`
  (`run: Math.floor(parsed.walkMP * 1.5)`); the same bug in `src/import/mulParser.js:177`
  (`run: Math.floor(walkMP * 1.5)`).
* **Manual (p48, HIP):** "Recalculate its Running MP accordingly by multiplying the new Walking MP
  by 1.5, rounding up." (p116 uses the same "rounded up" wording for the 2.5× MASC/supercharger case.)
* **Code behaviour:** an imported Atlas (walk 3) gets run 4 instead of 5; every odd walk MP loses one.
  The roster agrees with the manual (`tests/data/mechs.test.js:213-218` asserts
  `Math.ceil(walk * 1.5)`), so the same ’Mech has two different run ratings depending on whether it
  came from `mechs.json` or from a file import.
* **Pinning test (asserts the wrong value):** `tests/import/mtfParser.test.js:342` —
  `expect(mechDef.movement.run).toBe(4)` for walk 3.
* **Recommended fix:** `Math.ceil` in both places and update the test to 5.

---

### D-12 — MUL import fabricates a playable unit for unknown chassis (guessed MP, zero armour, no weapons)

* **Severity:** medium
* **File:line:** `src/import/mulParser.js:146-151` (`estimateWalkMP`: 6 / 5 / 4 / 3 by tonnage
  bracket) and `:157-186` (`buildStubMechDef`: every location `{front:0, rear:0}`, empty
  `criticalSlots`, `heatSinks 10`, `engine.rating = tonnage × estimated walk`).
* **Manual:** p6/p8 — a ’Mech's armour is a per-location set of circles on the record sheet, and
  p41-43 damage resolution sends every point of damage to internal structure once armour is gone; a
  unit with 0 armour in all eight locations has no legal record sheet. Nothing in the BMM authorises
  deriving Walking MP from tonnage (engine rating = tonnage × Walk MP, the inverse of what the code
  does).
* **Code behaviour:** a MUL entry for a ’Mech outside the roster (or with a `mekId` that is not
  supplied) becomes a unit that walks at a guessed speed, takes every hit on internal structure, has
  no weapons and 10 single heat sinks. `tests/import/mulParser.test.js:354-372` and `:401-411` pin
  this, labelling the fabricated numbers "correct movement by tonnage bracket".
* **Pinning test:** as above — the test asserts the heuristic, not any manual value.
* **Recommended fix:** refuse unknown units with a clear error, or create them flagged as
  unresolved proxies (and make the UI say so); never derive MP from tonnage.

---

### D-13 — `terrain.json` disagrees with the manual's Movement Costs / PSR tables in five places

* **Severity:** medium
* **Manual (p17 and p136 "MOVEMENT COSTS TABLE"):** "Cost to Enter Any Hex 1 … Clear +0;
  Paved/Bridge +0; Rough +1; Sand +0 (+1 PSR); Light woods +1; Heavy woods +2; Light jungle +2 (+1);
  Heavy jungle +3 (+2); Water Depth 1 +1† (Level change MP cost not included) (–1);
  Depth 2+ +3† (… +0, +1 if Depth 3+); Rubble +1 (+0) … Terrain Modifications: Ice +1 (+3§);
  Mud +1 (+1§); Deep Snow +1 (+1§); Swamp +1 (+1§)".
  Manual (p60) "WATER (DEPTH 2) … MP Modifier: +3; level change costs are not included."
  Manual (p54/p142) "’Mech entering hardened building hex +5".
* **File:line and code behaviour:**
  1. `src/data/terrain.json:34-41` `water_depth2.mpCost: 3`. The table's 3 is a *modifier* on top of
     the 1 MP to enter any hex, so the cost should be 4. (p12's worked example: "The first hex
     requires 6 MP to enter (1 for the hex, 3 MP for entering Depth 2+ water, and 2 more MP for
     moving from a clear hex to a Depth 2 hex)".) `src/rules/movement/MovementCalculator.js:16-27`
     duplicates the same wrong number, so both the data and the code need the fix.
  2. `src/data/terrain.json:56-62` `swamp.mpCost: 3` with no `psrModifier`; the manual has Swamp as a
     **terrain modification**: +1 MP and +1 PSR. (Note `tests/rules/movement/TerrainRules.test.js:31-32`
     already expects +1 PSR, so the two terrain paths disagree with each other.)
  3. `src/data/terrain.json:79-100` models ice / mud / deep snow as `mpCostMultiplier` 1.5 / 2 / 2.
     The manual's values are "+1" each, so any hex whose base cost is above 1 is overcharged
     (light woods + mud: manual 2+1 = 3, data 2×2 = 4). The PSR values (3 / 1 / 1) are correct.
  4. `src/data/terrain.json:49-55` `rubble.height: 1`; manual p60 "RUBBLE Line of Sight (LOS): No
     effect." Rubble should not raise the hex's height. (`height` appears unused by the LOS code
     today, so this is currently cosmetic.)
  5. `src/data/terrain.json:131-136` `buildings.hardened.psrModifier: 3`; the manual's building-entry
     PSR for a hardened building is **+5**. `src/rules/urban/Buildings.js:29, 33-35` feeds this value
     into `buildingDefaults()`/`entryPSRModifier()`, so entering a hardened building is 2 too easy.
* **Also missing** terrain types that the manual defines: sand, light jungle, heavy jungle,
  water depth 0 and water depth 3+ (p60/p136).
* **Pinning tests (assert the wrong values):** `tests/rules/movement/MovementCalculator.test.js:114`
  ("water_depth2 costs 3 MP"), `:132` ("swamp costs 3 MP"); `tests/ui/MovementPreview.test.js:573,
  597` (same two); `tests/rules/urban/Buildings.test.js:46` (`hardened … psrModifier: 3`) and `:151`
  (`entryPSRModifier('hardened') === 3`).
* **Recommended fix:** water_depth2 = 4, swamp modelled as a +1 MP / +1 PSR modifier (or cost 2 plus
  PSR 1), ice/mud/deep-snow modelled as +1 MP instead of multipliers, rubble height 0, hardened
  building PSR 5; add the missing terrain types; fix the duplicated table in `MovementCalculator`.

---

### D-14 — `criticalHitTable` in `hitTables.json` is invented, contradicts p46, and is unused

* **Severity:** low (dead data, but misleading if wired up)
* **File:line:** `src/data/hitTables.json:395-480`.
* **Manual (p46, DETERMINING CRITICAL HITS TABLE):** "Roll (2D6) Effect 2–7 No Critical Hit;
  8–9 Roll 1 Critical Hit Location; 10–11 Roll 2 Critical Hit Locations; 12 Head or Limb Blown Off /
  Roll 3 Critical Hit Locations* (*Roll 3 critical hit locations if the hit struck a torso
  location.)" — and "APPLYING CRITICAL HITS: Head or Leg Hits: … roll 1D6, find the result on the
  Critical Hit Table … Torso or Arm Hits: The Critical Hit Table for these locations is divided into
  two blocks of six slots … first rolls 1D6 … then rolls another 1D6".
* **Code behaviour:** the stored table gives per-location roll ranges (head 1–3 "Pilot hit", 4–6
  "Roll on critical effects"; arm 1–3 shoulder … 7 hand, 8–12 critical effects; leg 1–4 hip … foot;
  torso 1–12 critical effects) — a structure the manual does not have (a head critical hits the
  slot rolled, not a "pilot hit"; roll ranges starting at 1 cannot be a 2D6 table). `grep` finds no
  consumer: the only match for `criticalHitTable` in the repo is the JSON key itself.
* **Pinning test:** none.
* **Recommended fix:** delete it, or replace with the p46 two-step procedure (number of crits, then
  block + slot) so `DamageResolver` and the data agree.

---

### D-15 — `physicalWeapons.json` omits Talons and Vibroblade

* **Severity:** low
* **File:line:** `src/data/physicalWeapons.json:4-12` (7 entries).
* **Manual (p38 / p140, Physical Weapon Attacks Table):** nine rows — the file has claws, flail,
  hatchet, lance, mace, retractable blade, sword (all values match the manual exactly), but not
  "Talons 0 ×1.5 As per attack Kicks only" or "Vibroblade Activated –2 / Deactivated –2
  (1 per 10 tons) +1".
* **Code behaviour:** none today (no roster unit mounts them); the file's own `source` field claims it
  is the complete p38 table.
* **Recommended fix:** add the two rows (with a `kick`-only marker for talons and a two-mode entry for
  the vibroblade) or correct the `source`/`notes` to say it is a subset.

---

### D-16 — `equipment.json` values with no BMM basis (or a shape the manual cannot express)

* **Severity:** low–medium, item by item
* **Manual quotes used below:** p50 Heat Point Table ("Jumping +1 per hex (min. of 3 per turn)");
  p14 ("Heat Generated: 1 heat point for every hex jumped … always generates a minimum of 3 heat
  points"); p126 (Jump Jet, Standard: tons `*`, 1 crit — "`*`This item’s tonnage and/or critical slot
  placement requires construction rules not covered in this book."; Targeting Computer `*` `*`;
  MASC `*` `*`; Heat Sink, Double 1 ton / 3 crits); p112 ECM Suites (disruption of Artemis / Narc /
  C3 / probes); p26 GATOR (no ECM Target Number modifier listed); p116 MASC ("On a result of 2, the
  player automatically assigns one critical hit to each leg … second consecutive turn, a result of 4
  or less … third … 6 or less … fourth … 10 or less … fifth turn … automatically"); p118 CASE ("If
  ammo … in a CASE-equipped location explodes, resolve the resulting damage to the internal structure
  in that location as normal. However, any excess damage is ignored").
* **Items:**
  * `equipment.json:17-23` `jump_jet.heatPerUse: 3` encodes only the *minimum*; the manual's rule is
    1 heat per hex with a floor of 3 (p14/p50). A 6-hex jump must cost 6, not 3.
  * `equipment.json:22` note "Weight = roundUp(tonnage/10) per jet" is invented; p126 lists jump-jet
    tonnage as `*` (construction rules outside the book).
  * `equipment.json:40-47` `targeting_computer.weightFormula: "tonnage/10 rounded up"` — p126 lists
    TC tonnage as `*`; the stated formula is not in the BMM.
  * `equipment.json:32-39` `ecm.toHitModifierEnemy: 1` — p112 gives ECM *effects* (blocked Artemis,
    severed C3, dead Narc, hidden probes), not a +1 TN; p26's GATOR list has no ECM entry. (Overlaps
    the electronics audit.)
  * `equipment.json:48-56` `masc.failureRollTarget: 3` / `failureDamage: "leg actuator"` — the manual
    escalates across consecutive turns (3+/5+/7+/11+/automatic) and assigns "one critical hit to each
    leg"; the data has no per-turn state and misnames the effect.
  * `equipment.json:26-30` `case.location: "sideTorsoOnly"` — the p118 rules place no such
    restriction (and describe CASE in a location that receives transferred damage); placement rules
    are construction, outside the BMM.
  * `equipment.json:10-16` `heat_sink_double` has no critical-slot count; p126 gives IS double sinks
    3 crits each, which is what any crit-layout check would need.
* **Pinning tests:** none of these values is asserted against a manual value; the equipment
  integration tests exercise behaviour, not the numbers.

---

### D-17 — Locust LCT-1V leg armour exceeds twice its internal structure

* **Severity:** medium (illegal design data)
* **File:line:** `src/data/mechs.json:2359-2366` (`leftLeg.front: 10`, `rightLeg.front: 10`) against
  `:2375-2376` (`leftLeg: 4`, `rightLeg: 4`).
* **Manual basis (example only):** p44's worked damage example prints the 70-ton Grasshopper diagram
  as `Left Arm (22)` over `LeftArm (11)`, `Left Leg (26)` over `LeftLeg (15)`, i.e. at most two points
  of armour per point of internal structure per location. The general armour-limit rule is a
  construction rule and is **not** stated in the BMM (see §C), so this is flagged as a data
  inconsistency against the book's only armour example: 10 armour on a 4-structure leg is 2 over.
* **Code behaviour:** damage resolution works, but the ’Mech carries 4 armor points more than a legal
  design of that tonnage, which skews every Locust engagement.
* **Pinning test:** `tests/data/mechs.test.js:111-119` only checks head ≤ 9 and non-negativity.
* **Recommended fix:** set both legs to 8 and add a "front armour ≤ 2 × internal structure per
  location (head ≤ 9)" data test.

---

### D-18 — MTF-derived unit ids never match roster ids

* **Severity:** low
* **File:line:** `src/import/unitConverter.js:195`
  (`id = chassis-to-kebab + '-' + model-to-kebab` → `atlas-as7-d`) vs `src/data/mechs.json:4`
  (`atlas-as7d`); `src/import/mulParser.js:113-116` already works around this with an alternate id.
* **Code behaviour:** an exported-then-reimported Atlas is a *different* unit from the roster Atlas
  (roster lookups, force-builder de-duplication and saved state all key on id), even though the name,
  mass and armour are identical.
* **Pinning tests:** `tests/import/mtfParser.test.js:338` and `tests/export/mtfExporter.test.js:461`
  both assert `atlas-as7-d`, so the mismatch is treated as expected behaviour.
* **Recommended fix:** normalise model ids (strip hyphens, or match against the roster before minting
  an id) and assert that a round trip preserves the roster id.

---

### D-19 — fabricated/invented values in the import helpers

* **Severity:** low
* **File:line:** `src/import/unitConverter.js:4-10` (`ammoShotsPerTon`) and `:157`
  (`explosiveAmmo = new Set(Object.values(WEAPON_NAME_MAP))`).
* **Manual:** p121 Inner Sphere Weapons shots-per-ton column confirms AC/2 45, AC/5 20, AC/10 10,
  AC/20 5, LRM 5/10/15/20 24/12/8/6, Machine Gun 200 — all match the helper. The Flamer row's
  shots-per-ton is "—" (fusion-powered), so `flamer: 20` is invented and would give a flamer an ammo
  bin. `explosiveAmmo` is a set of *weapon* ids, so every imported ammo bin is marked explosive even
  though p96/p106 define non-explosive ammunition (e.g. Plasma Rifle: "Ammunition: Non-explosive").
* **Recommended fix:** drop the flamer entry and derive `explosive` from an explicit non-explosive
  list.

---

### D-20 — `maps/urban.json` uses building terrain ids that `terrain.json` does not define

* **Severity:** low
* **File:line:** `src/data/maps/urban.json` — 12 hexes: `2,2 2,3 3,2 3,3 = light_building`,
  `6,2 6,3 7,2 7,3 = medium_building`, `10,2 10,3 11,2 11,3 = heavy_building`.
* **Code behaviour:** `src/main.js:108` copies `data.terrain` into `Hex.terrainType`, so
  `Hex.getMPCost(terrain.json)` (`src/models/Hex.js:40-45`) finds no entry and returns 1 — a building
  hex costs the same as clear terrain on that path — and `Hex.blocksLOS()` returns false. The building
  CF/levels do survive, because `BuildingRegistry.fromMap` (`src/rules/urban/Buildings.js:105-137`,
  `TERRAIN_TO_TYPE` at `:13-18`) maps those ids onto `terrain.json.buildings`. Rendering is fine
  (`MapRenderer.js:20-23` has colours for them). So the ids are "known" to two subsystems and unknown
  to the data file's own `terrain` map.
* **Pinning test (asserts the constant):** `tests/maps/Mapsheets.test.js:9-13` defines its own
  `VALID_TERRAIN` set that includes the three building ids, instead of deriving the valid ids from
  `terrain.json`; the test therefore passes while the data is inconsistent.
* **Recommended fix:** add `light_building`/`medium_building`/`heavy_building`/`hardened_building`
  entries to `terrain.json.terrain` (or make the test read the ids from `terrain.json` plus
  `TERRAIN_TO_TYPE`).

---

### D-21 — maps store water hexes at level 0, so the water level-change cost can never be applied

* **Severity:** low–medium (movement cost)
* **File:line:** `src/data/maps/*.json` — every water hex is `{"terrain":"water_depthN","level":0}`
  (e.g. `grassland.json` `0,2`, `2,3`; `forest.json` `7,7`; `desert.json` `9,3`; `tundra.json` `6,11`).
* **Manual (p22):** "Ground hexes lower than Level 0 are marked as Sublevels, while water is marked in
  Depths. Both are treated as negative height. For example, a hex at Depth 2 or Sublevel 2 is at
  Level –2." Manual (p128): "entering Depth 1 water from a Level 0 hex costs 3 MP. It always costs
  1 MP to enter any hex. In addition, it costs 1 MP for changing from Level 0 to Depth 1, and 1 MP to
  enter a Depth 1 water hex." Manual (p17/p136): "Water Depth 1 +1† (Level change MP cost not
  included)".
* **Code behaviour:** with every water hex at level 0 the level-difference term in
  `MovementCalculator.calculateMPCost` (`:51-57`) is 0, so entering Depth 1 water costs 2 and Depth 2
  costs 3 instead of 3 and 6. `tests/maps/Mapsheets.test.js:62-69` forbids the fix by asserting
  `hex.level >= 0` for every hex.
* **Recommended fix:** encode water hexes with negative levels (or a `depth` field the movement code
  reads) and change the map test to assert `level === -depth` for water hexes.

---

## B. Verified correct against the manual (positive results)

* **`weapons.json` — all 17 entries checked row by row against p121–p122** and they match, including
  min range and bracket ends: Medium Laser 3/5/0/1–3/4–6/7–9; Large Laser 8/8/0/1–5/6–10/11–15;
  PPC 10/10/3/1–6/7–12/13–18; AC/2 1/2/4/1–8/9–16/17–24; AC/5 1/5/3/1–6/7–12/13–18;
  AC/10 3/10/0/1–5/6–10/11–15; AC/20 7/20/0/1–3/4–6/7–9; LRM-5/10/15/20 heat 2/4/5/6, "1/Msl",
  min 6, 1–7/8–14/15–21; Machine Gun 0/2/0/1/2/3; Flamer 3/2/0/1/2/3. Cluster flags are right
  (SRM/LRM only) with weapon sizes 2/4/6 and 5/10/15/20, and `ammoPerShot` 0 for energy weapons.
  SRM heat values could not be row-verified (see §C), but the SRM **damage, grouping and brackets**
  are confirmed by the p122 SRM-ammo rows ("SRM ammo — 2 2/Msl, C2/3 0 1–3 4–6 7–9").
* **`hitTables.json.clusterTable` (`:228-394`) matches p139 exactly** for all 12 rolls × 13 columns
  (2–12 × 2,3,4,5,6,7,9,10,12,15,20,30,40). The claim in `RULES_AUDIT_REFERENCE.md` §5 that the
  table is "simplified and inaccurate" and lacks sizes 7/9/12 is **stale** — 9 and 12 are present
  and every value is correct.
* **`heatScale.json` matches p52** on every stated threshold: weapon-attack modifiers at
  8/13/17/24 ("At 8, 13, 17, and 24 heat points, add the number indicated"); shutdown at
  14/18/22/26/30 with the documented avoid targets ("a ’Mech with 19-22 heat would need a 4+, 23-27
  heat a 6+, and 28-30 heat an 8+"); ammo explosion at 19 → 4+, 23 → 6+, 28 → 8+. The only blemish is
  a redundant `{"heat": 29, "shutdownAvoid": 10}` step (`heatScale.json:21`) that restates the 26
  step and never changes a result.
* **`quirks.json` matches the p145 Negative Quirk Table** for all eight entries, cost and effect:
  Poor Targeting (Short/Medium/Long) 2; Cramped Cockpit 2; Hard to Pilot 2; Inaccurate Weapon
  "Variable"; Poor Cooling Jacket 1; Sensor Ghosts 3; Unbalanced 1.
* **`mechs.json` structural data:** run MP = ceil(walk × 1.5) for all 14 entries (p48 wording); the
  70-ton Warhammer's internal structure (head 3, CT 22, LT/RT 15, arms 11, legs 15) equals the
  Grasshopper values printed on p44; internal-structure curves are consistent across all tonnages
  (20 t 6/5/3/4 … 100 t 31/21/17/21, head 3 everywhere); every location has 12 critical lines and the
  head 6; weapon critical-slot runs match p121–p122 (AC/20 10, LRM-20 5, LRM-15 3, LRM-10 2, PPC 3,
  AC/5 4, Large Laser 2, Medium Laser/SRM/LRM-5/MG/Flamer 1).
* **`physicalWeapons.json` rows that exist** match p38 exactly, including the "1 per X tons, round
  fractions up" note, the sword's +1 bonus and the hit-location column semantics.
* **`terrain.json` building CFs match p66 defaults exactly:** "assume that a light building hex has
  CF 15, a medium building hex has CF 40, a heavy building hex has CF 90, and a hardened building hex
  has CF 120" (`terrain.json:112-137`); ice/mud/deep-snow PSR modifiers (3/1/1) match p54/p136.
* **Map dimensions:** all six maps are 17 × 15 = 255 hexes with complete, unique `col,row` keys,
  matching p6's "a single 18 by 22-inch (15 x 17 hex) playing map"; all non-building terrain ids
  resolve in `terrain.json`.
* **`tests/data/mechs.test.js:213-218`** is the one test in the data area that asserts a
  manual-derived rule (`run = ceil(walk × 1.5)`) rather than a copied constant — the right pattern for
  the D-11/D-13 fixes.

---

## C. Cannot verify from the KB

| # | Item | Why |
|---|------|-----|
| C1 | **SRM-2/4/6 launcher rows** (heat 2/3/4, tons 1/2/3, crits 1/2, shots per ton 50/25/15) | The p121 chunk ends at "Medium Pulse Laser"; the p122 chunk resumes at "Pulse Weapons (continued)". No chunk contains the SRM rows. Damage/grouping/brackets were cross-checked via the p122 SRM-ammo rows. |
| C2 | **Clan weapons and equipment (p124–125, 127)** | Only the Clan *equipment* table is present; the Clan weapons table is not in the KB. `weapons.json`/`equipment.json` are Inner Sphere only, and the Clan equipment table was used only to confirm TSM is 0 tons / 6 crits (also on p126). |
| C3 | **ECM suite tonnage/crits (Guardian)** | Not present in the p126 or p127 equipment tables in the KB (Electronics sections list Artemis/C3/Targeting Computer only). `equipment.json.ecm.weight: 1.5` is therefore unconfirmed (and its `toHitModifierEnemy: 1` has no basis — see D-16). |
| C4 | **MTF and MUL file grammars** (header key names, rear-mount notation, rear-armour key `RTL` vs `LTR`, crit-section line counts, `Heat Sinks` field semantics) | The BattleMech Manual documents none of it. The format findings (D-06, D-07, D-08, D-09, D-10) are therefore argued from the repo's own importer/exporter/fixtures and from the record-sheet content the values must represent, not from a manual quote. D-07's leg count in particular needs a check against a printed record sheet: the p6 SLOT sentence as captured by the KB ("six in the head and legs, twelve in other locations") conflicts with the 12-slot legs used throughout this project. |
| C5 | **Armour limits (2 × internal structure per location), internal-structure tables, engine-rating = tonnage × Walk MP, minimum 10 heat sinks, jump-jet tonnage, maximum jump jets = Walk MP** | All construction rules; p126/p127 mark these values with "`*` … requires construction rules not covered in this book". D-17 is flagged against the p44 example only. |
| C6 | **Individual ’Mech record sheets** (Atlas/Locust/etc. tonnage, armour, weapons, ammo counts) | The BMM contains no unit record sheets. Everything in D-02/D-05/D-17 is argued from internal consistency, the manual's rules for what the data *means*, and the p44 example — not from a printed sheet for that chassis. |
| C7 | **`src/data/maps/*.json` terrain layouts** | Mapsheets are a physical product; the manual gives terrain rules (p59–61) but no map contents. Only the 15 × 17 grid size and the terrain-id vocabulary can be checked. |
| C8 | **`hitTables.json.criticalHitTable` slot contents** (which component sits in which slot) | p46 gives the procedure and the tables' shape but the sample tables in the book are worked examples for a JagerMech/Quickdraw, not a general slot map. The finding (D-14) is about shape and dead data, not about specific slot contents. |

---

## D. Tests that assert code constants instead of manual values

| Test | Line | What it pins | Manual says |
|------|------|--------------|-------------|
| `tests/rules/combat/HitTables.test.js` | 74-107 | left column = copy of front (`3→rightArm`, `8→leftTorso` …) | p139: `3→Left Leg`, `8→Center Torso`, `2→Left Torso` |
| `tests/rules/combat/HitTables.test.js` | 110-143 | right column = mirror of the same | p139: `3→Right Leg`, `8→Center Torso`, `2→Right Torso` |
| `tests/rules/combat/HitTables.test.js` | 165-179 | left/right tables are mirror images | p139 columns are not mirror images of the *front* column |
| `tests/rules/combat/PhysicalAttackResolver.test.js` | 41-53, 59-71 | `EXPECTED_PUNCH`/`EXPECTED_KICK` copied verbatim from `hitTables.json` (self-referential test) | p140: punch is 1D6 (1 LA, 2 LT, 3 CT, 4 RT, 5 RA, 6 Head); kick is 1D6 in three columns |
| `tests/import/mtfParser.test.js` | 342 | `movement.run === 4` for walk 3 | p48: "multiplying the new Walking MP by 1.5, rounding up" → 5 |
| `tests/rules/movement/MovementCalculator.test.js` | 114, 132 | water_depth2 = 3 MP, swamp = 3 MP | p17/p136: Depth 2+ `+3` on top of 1; Swamp `+1` |
| `tests/ui/MovementPreview.test.js` | 573, 597 | same two values | as above |
| `tests/rules/urban/Buildings.test.js` | 46, 151 | hardened building PSR modifier = 3 | p54/p142: "entering hardened building hex +5" |
| `tests/import/mulParser.test.js` | 401-411 | "correct movement by tonnage bracket" (6/5/4/3 walk) | No BMM rule derives Walk MP from tonnage |
| `tests/maps/Mapsheets.test.js` | 9-13, 62-69 | `VALID_TERRAIN` hard-codes ids absent from `terrain.json`; forbids negative hex levels | p22: water is "negative height" (Depth 2 = Level −2) |
| `tests/import/mtfParser.test.js` | 415-429 | ammo shots 15/30/12 for 3/2/2 bins | p121-122 shots-per-ton (5/15/6) × bins — **correct**, listed as the good pattern |
| `tests/data/mechs.test.js` | 213-218 | `run === ceil(walk × 1.5)` | p48 — **correct**, the pattern the D-11 fix should follow |

Note: `RULES_AUDIT_REFERENCE.md` is itself a source of stale claims — §5 (cluster table "simplified")
and its terrain table (Ice PSR +4, Swamp cost 3) do not match either the KB or the code. The collated
report should not reuse those claims without re-checking them against the KB.
