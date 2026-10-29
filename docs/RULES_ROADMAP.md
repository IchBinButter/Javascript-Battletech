# Rules Roadmap — what to implement next

Plan derived from the BattleMech Manual (7th printing) in the knowledge base and an
audit of the current engine. Page references are BMM pages.

Conventions and scope live in `docs/DESIGN_PRINCIPLES.md`; current defects with evidence
live in `docs/RULES_COMPLIANCE_SWEEP.md`.

## Roster scope and the chassis/variant restructure

- **Scope:** 3025-era **Inner Sphere** BattleMechs. **Canon only** — no custom variants
  (notable pilots, Solaris one-offs) and no apocryphal variants (video-game or novel-only
  designs). A variant is eligible when an official tabletop publication defines it; reference
  wikis are for orientation, record sheets are authoritative.
- **Roster freeze:** no new 'Mechs are added until the data model is restructured. The
  next bulk import waits for it.
- **Target model:** a chassis layer (tonnage, internal structure, quirks, tech base) and a
  variant layer (engine, gyro, armour, heat sinks, critical slots, equipment), compiled to
  the flat `src/data/mechs.json` the engine already consumes. The Atlas family alone has
  23 canonical variants, so a flat hand-authored file does not scale; the runtime contract
  stays flat so the importer, exporter and engine are untouched.
- **Cheap precursors to do in the data-hygiene pass:** add `chassisId` to every entry;
  derive `internalStructure` from tonnage (p44) and `walk`/`run` from engine rating (p48)
  instead of storing them.

## Where the engine actually stands

| Area | State | Evidence |
|---|---|---|
| Heat scale (MP / TN / avoid targets) | ✅ complete | `src/data/heatScale.json`, `src/rules/heat/HeatScale.js` |
| Heat *consequences* | ✅ complete | one bin explodes per ammo slot (p52); engine-crit heat +5/+10 before dissipation (p47/p50); water cooling per sink type, capped +6 (p51) |
| MP / TSM / MASC | ✅ formulas, activation dead | `src/rules/movement/maxMP.js`; MASC activation is not wired (Phase A) |
| GATOR movement + range + heat + woods | ✅ matches p28 | `AttackResolver.calculateTargetNumber` |
| Cluster hits, hit location, kick/punch tables | ✅ matches p33/137 | `src/data/hitTables.json` |
| Ammunition model | ✅ one bin per critical slot | `mechs.json` + importer; a single-bin explosion (p44/p52) |
| **Firing arcs** | ✅ 1.1 done | `src/rules/combat/ArcRules.js`, enforced in `AttackResolver` and `GameEngine` |
| **LOS height / partial cover** | ✅ 1.2/1.3 done | `Unit.getLOSLevel`, `LineOfSight` rewritten against p22/p26 |
| **Partial cover hit rule** | ✅ 1.3 done | leg hits strike the cover and do no damage (p26/p32); cover-from-building damage still open (C-10) |
| **Prone target modifier** | ✅ p28 | −2 adjacent / +1 otherwise |
| **Pilot damage** | ✅ p58 | head hits, falls, ammo explosions, life support heat; 3/5/7/10/11/dead |
| **Actuator / hip / shoulder crits** | ✅ p47-49 | weapon and physical modifiers, hip MP, sensors +2, engine heat |
| **Physical attack TN table** | ✅ p137 | punch 0, kick −2, push −1, charge/DFA comparative, actuator damage p29 |
| **PSR modifiers and triggers** | ✅ real triggers only | p54/p60: 20+ damage, physicals, hip/gyro/leg, water depth, terrain; woods no PSR, jungle +1/+2, sand +1; fabricated causes removed |
| **Initiative / unequal forces** | ✅ p10/p12 | loser declares first (house rule removed); 2:1 and 3:1 declaration blocks replay the printed tables |
| **Jump movement** | ✅ p18 | facing ignored, overflight, height limit Jump MP + start level, landing facing through the engine (UI picker still absent) |
| **Indirect fire / spotting** | ✅ core done, extensions open | `_validateIndirectFire` (p30-31); open: spotter declaration restriction, TAG/Narc/Artemis (era-gated) |
| **Buildings / urban** | ⚠️ shipped, elevation gap | levels, roofs, interiors, basements, collapse (p66-74); no floor model, so roofs are unreachable in play |
| Weather, fire, hidden, mines, quirks | ✅ Phase 6 shipped, quirks thin | quirks: 9 negative only, no positive quirks and no chassis-level inheritance |

The pattern: **tables and dice are faithful; geometry and consequences are not.**
Any weapon can shoot in any direction, a 'Mech's arm can be shot off with no effect on
its shooting, and a MechWarrior can never be hurt. Those three gaps are the difference
between a dice calculator and a game.

---

## Phase 1 — Combat geometry (BMM p22–30)  ✅ shipped

Nothing else matters until attacks care about direction. Every later feature
(rear-mounted weapons, AMS arcs, physical attacks, indirect fire) depends on this.

### 1.1 Firing arcs — new `src/rules/combat/ArcRules.js`  ✅ done

- `getArc(attacker, weaponLocation, targetHex, { torsoTwist, armsReversed })` returns
  `forward | left | right | rear`.
- Forward arc covers the front 180°. Arm weapons extend one hexside into their own side
  arc. Rear arc only for rear-mounted weapons, or any arm weapon when arms are flipped.
- Split-location weapons (torso + arm slots) use the torso arc.
- `canFireInto(arc, weaponLocation, mount)` gates `GameEngine._handleFire` and
  `AttackResolver.calculateTargetNumber` (`canFire: false` with a reason).

Acceptance: a weapon in the left arm cannot hit a unit in the right side arc; flipping
arms moves arm weapons to the rear arc; twisting ±1 shifts arm and torso arcs but not
facing.

### 1.2 'Mech height in LOS (`LineOfSight`, p22)  ✅ done

- `Unit.getLOSLevel()` = hex level + 2 standing / + 1 prone; `getHeightLevels()` exposes
  the Mech's own height.
- LOS level drives the attacker, the target and the intervening comparison: a hex blocks
  when its height reaches the **lower** of the two LOS levels. That threshold is what
  makes a Level 1 hex cover rather than a wall, and what hides a prone Mech behind one.
- `getHeight()` stays the terrain/building height.

Acceptance: a 'Mech on Level 0 can see over a Level 1 hill it could not see over before;
a prone 'Mech behind a Level 1 hex is not visible to a Level 0 attacker.

### 1.3 Partial cover, corrected (p26)  ✅ done

The old test (`ihex.level >= targetHeight + 2` over the last two hexes) is replaced:
target standing, the hex adjacent along the LOS one level higher than the target's hex,
and the attacker's LOS level not higher. Prone targets get none. Depth-1 water always
gives it. The result reports `partialCoverHex` and `partialCoverKind`
(`hill` / `building` / `water`).

### 1.4 Partial cover hit rule (p26, p32; misconception 8, p130)  ✅ done

With partial cover, a leg hit strikes the cover instead: absorbed, no damage, no re-roll,
and the cover hex is recorded for building damage later. **Not** the punch table — that
is the pre-2006 rule.

### 1.5 Target state modifiers (p28)  ✅ done

Prone target −2 from an adjacent hex and +1 from anywhere else; attacker prone +2;
skidding +2 as a target and +1 to fire.

### 1.6 Attacker damage modifiers (p28)  ✅ done

Sensor hit +2. Shoulder hit +4 for weapons in that arm, ignoring the other actuators;
upper/lower arm actuator +1 each. Lives in `src/rules/combat/UnitDamage.js`, shared with
the physical attack rules.

### 1.7 Multiple targets (p27)  ✅ done

First target free; each secondary target +1 if in forward arc, +2 if side/rear.

### 1.8 Twist and flip as declared actions (p24–25)  ✅ done

- Torso twist ±1 hexside during the weapon attack phase (shifts arcs, not facing).
- Arm flip only if no hand/lower-arm actuators in either arm; cannot twist and flip in
  the same turn; both return to front in the End Phase.
- `mechs.json` now carries the actuators (shoulder/upper/lower arm, hip/upper/lower
  leg/foot), so eligibility is real: the canon roster has hands and cannot flip, and the
  Banshee refit (no hand or lower-arm actuators) can.

### 1.9 Rear-mounted weapons  ✅ done (in 1.1)

`Weapon.mount` defaults from `special.rear`, and `ArcRules` restricts rear mounts to the
rear arc.

**Size:** L (roughly 3 PRs). **Tests:** new `tests/rules/combat/ArcRules.test.js`, plus
LOS, partial cover and modifier cases in the existing suites.

---

## Phase 2 — Pilot and damage continuity (p41–49, p52, p58)  ✅ done

2.1 ✅ **Pilot damage sources** — head hits, falls, ammunition explosions and life-support
heat all call `Unit.applyPilotDamage`. Hull breach and ejection are still absent (both need
environmental rules).
2.2 ✅ **Consciousness ladder** — 3+/5+/7+/10+/11+, and the sixth point is death; the old
array treated the fifth hit as automatic unconsciousness.
2.3 ✅ **Critical hit effects** — hip (half MP, no kick), upper/lower leg actuator, foot
actuator, shoulder, upper/lower arm actuator, hand actuator, sensors (+2 TN), life support
(pilot heat damage), engine heat (+5 then +10 per turn).
2.4 ✅ **PSR modifiers from crits** — gyro +3, +2 per hip, leg actuators +1 each, no
double-counting a hip as an actuator.
2.5 ✅ **Heat consequences** — one ammunition bin explodes (most damage per turn, then most
shots), 2 points of MechWarrior damage, a spotter-check PSR at +3 on involuntary shutdown,
and shutdown Mechs automatically fail PSRs.

**Data:** `mechs.json` now carries every structural slot the rules read — engine, gyro,
cockpit, sensors, life support, and the arm/leg actuators — with all locations at their
record-sheet size (12 slots, 6 in the head) and heat sink slots matching the sinks the
engine does not house. Two non-canon refits (`atlas-as7d-refit`, `banshee-bnc3e-refit`)
exist so the equipment rules are reachable in play.

**Size:** M–L. **Why second:** it makes every existing damage result visible, and Phase 1
item 1.6 needs the actuator state anyway.

---

## Phase 3 — Physical attacks (p34–40)

3.1 ✅ TN table: punch 0, kick −2, push −1, club −1, DFA 0 (+3 jumping), charge comparative
piloting-skill modifier.
3.2 ✅ Legality: forward arc for kick/charge/push/club, front or side for punches with the
arm on that side, both hips required to kick, the Different Levels table (p140) and prone
targets (a prone Mech can be punched or clubbed at or above its level, only DFA below).
3.3 ✅ Damage: punch 1/10 tons, kick 1/5, both rounded up, halved per damaged actuator;
charge tonnage/10 × hexes charged, rounded up. DFA damage is still the old formula: the KB
chunk for p37 does not state it.
3.4 ✅ Consequences: successful kick → target PSR; missed kick → attacker PSR; charge →
both PSR +2; missed DFA → automatic fall; successful DFA → attacker PSR +4.
3.5 ✅ Physical weapons (claws, flail, hatchet, lance, mace, retractable blade, sword) from
the p38 table as `src/data/physicalWeapons.json`, with TSM doubling, the +4 option-table
declaration, and the "no physical attack from an arm that fired" restriction.

Still open in this phase: applying the charge self-damage to the attacker, clubs found on
the battlefield, and a UI action for physical weapons (no Mech in `mechs.json` mounts one
yet, so the rules are tested but unreachable in play).

**Size:** M.

---

## Phase 4 — Indirect fire and spotting (p30–31)  ✅ done

- LRMs may fire at a target the attacker cannot see, provided a friendly spotter can;
  a Mech with its own line of sight cannot fire indirectly
- target number: +1 indirect, the spotter's own movement modifier, terrain and partial
  cover taken from the spotter's line of sight, +1 more when the spotter also attacked
- a Mech that spots and attacks takes +1 on its own attacks
- indirect damage always strikes the target, including on a leg hit, unless the cover is
  water (p30)
- aimed shots (p30): immobile targets only, no cluster weapons, never with indirect fire;
  a 6–8 on the follow-up roll lands the shot on the designated location

**Open now (era-neutral):**

- A spotter may not have charged or launched a DFA that turn (p30); needs a per-turn
  declaration record on the spotter.
- Aimed shots against partial cover: the follow-up roll and the cover interaction are only
  partly covered (sweep C-11/C-12); p30 now has a body in the KB.
- Hidden 'Mechs may spot (p82): the visibility layer exists, the spotting hook does not.

**Era-gated — do not implement while the roster is 3025 Inner Sphere:**

TAG, Narc and Artemis IV are 3040s–3050s technology. The manual has the rules (TAG
designation p58, ECM interaction p112), and the importer already maps the names
(`tag`, `narc`, `artemis_iv` in `unitConverter`/`mtfExporter`), but `equipment.json` has no
gameplay entries and there is no pod/beacon model. Adding them now would create unreachable
equipment — the defect class this project is actively removing. Sketch for when the era
opens: equipment rows (tonnage/crits/heat, p121), a TAG designation mark on the target,
a Narc pod attachment with its cluster bonus, Artemis IV cluster-roll bonus, and the p112
ECM suppression of all three. The cluster roll currently has no modifier pipeline, so that
is the first slice.

---

## Phase 5 — Urban combat (p66–74)

`terrain.json` already defines the four building types (CF 15/40/90/120, levels 1–4) and
`urban.json` already places three 2x2 building blocks — but as bare *terrain types* that
nothing reads. So the first slice is a wiring job, exactly like the actuator data.

5.1 ✅ **Building model** — `src/rules/urban/Buildings.js` resolves a map's buildings into
per-hex `hex.building` objects (per-hex CF, shared building id) plus a registry, applies
them at map load, and gives the renderer real building colours and a CF label. Terrain-only
maps get synthetic one-hex buildings.
5.2 ✅ **Entering buildings** — a Level-0 entry rolls a PSR at the building's modifier
(light 0, medium +1, heavy +2, hardened +5; p54/p142), the hex takes `ceil(tonnage/10)` whatever the
roll, and a failed roll costs the 'Mech the same damage. Jumping onto a building does
neither.
5.3 ✅ **Collapse** — a hex at CF 0 becomes rubble and its occupants take
`ceil((CF at phase start / 10) x (1 + levels above))`; losing more than half a building's
hexes brings the rest down. Collapse from attack damage resolves at the end of the Weapon
Attack Phase.
5.4 ✅ **Combat within buildings** — +1 TN for a target inside a building, +1 per
intervening building hex/level (capped at +3), line of sight blocked beyond two, and each
hit reduced by `ceil(currentCF/10)` with the absorbed damage charged to the hex. Wave 2
added the missing half: the LOS count now includes **levels** (a Level-1 Warhammer is
TN 10, a Level-2 Locust TN 8, exactly as p72's example), a **roof occupant is not
"inside"** (no +1, no CF absorption, full damage), building-interior LOS takes precedence
over the generic height check, and — critically — the +1/+2 modifier is now **forwarded
into the attack roll** instead of being computed and discarded.
5.5 ✅ **Basements** — the 2D6 Basements Table is rolled once per hex per scenario on
first Level-0 entry; a basement drops the 'Mech 1–2 levels for `tonnage/10 x (levels + 1)`
falling damage, prones it, and the building hex takes `tonnage/10` (double for a two-level
basement). A 'Mech heavier than the hex's CF at the start of the phase falls through even
when the roll says no basement.

**Still open in this phase:**

- **Unit elevation / floor model (the large one).** Units have no movement floor: nothing
  writes `position.level`, so every 'Mech defaults to "inside at Level 0" and roofs or upper
  floors only exist when a scenario sets the level by hand. This is what keeps the building
  rules from being playable as written (see Phase 8a).
- **C-10** — partial cover from a building must **damage the building** when a leg hit
  strikes it (p26/p32); today the hit is discarded.
- Collapse damage uses the standard front hit table rather than the Punch table (p73).
- The adjacent-attacker exception for missed shots is not implemented.
- Building CF damage is applied immediately even though collapse waits for the phase end.
- The Facing After Fall Table is not rolled for a basement fall.
- MapRenderer has no floor/roof distinction and no jungle/sand colours (cosmetic).

**Size:** M-L for what shipped; the elevation model alone is an L. **Multiplayer:** building
CF is public state, so it rides in the patch — but the damage-routing events must be
JSON-safe (see R4).

---

## Phase 5.5 — Multiplayer readiness (retrofit, before 6.4 and 7.4)

The rules are player-agnostic and the engine is already DOM-free, so phases 1–4 do not need
revisiting. The plumbing does, while the codebase is still small:

- ✅ **R1 Visibility seam** — `src/engine/visibility.js` provides `canSee` and
  `projectStateForPlayer`; the engine refuses to fire at a hidden unit, and the projection
  keeps the GameState prototype so the UI can keep calling its helpers. The renderer and UI
  now read through the projection (6.4).
- ✅ **R2 Determinism** — unit ids come from a sequence instead of `Date.now()`, the game id
  is seqential or injected and seeds the dice, the initiative tie fallback is the lowest
  player id instead of `Math.random`, and `HexGrid` generation takes an injectable RNG.
- ✅ **R3 Serialization** — `toJSON`/`fromJSON` on Hex, Unit and GameState (Units and Hexes
  rebuilt as instances, Sets restored), and `deepClone` now handles `Set` (previously
  `firedThisTurn` cloned to a plain object).
- ✅ **R4 JSON-safe events** — `physicalAttackResolved` is passed through `toTransferable`,
  so the payload survives a WebSocket/postMessage hop.
- ✅ **R5 Command boundary** — a test scans `src/ui` for direct unit/state writes and the UI
  keeps its own selection state; every command goes through `engine.processAction`.
- ✅ **M2 Replay equivalence** — two engines built with the same game id and fed the same
  action list end in identical state, and different game ids produce different dice streams.
- ✅ **M3 Diff sync** — `getStateDiff`/`applyStateDiff` now also carry `initiativeWinner`,
  fire hexes, smoke and per-hex changes (building CF, rubble, basements); a snapshot plus its
  patch rebuilds the live state through `GameState.fromJSON`.
- ✅ **M4 Projection-safe patches** — a patch computed from two projected views never
  mentions a hidden unit, while the raw diff does (a control test proves the projection is
  doing real work). Note that projections are shallow: a server must serialize a view before
  caching it as the last-sent snapshot, or the hidden state will mutate it.

---

## Phase 6 — Optional layers (p61–64, p75–95)

6.1 ✅ **Terrain modifiers** — ice (+1 MP, PSR +3 — the data had +4, corrected against the
Movement Costs Table), mud and deep snow (+1 MP, PSR +1) and swamp (PSR +1) now produce PSR
triggers from the destination hex. The same pass fixed building MP costs: the table charges
light +1, medium +2, heavy +3, hardened +4 on top of the one point to enter a hex, which
replaces the earlier assumption that a ground-level entry cost one MP. *S*
6.2 ✅ **Weather and planetary conditions** (p62–63) — `src/rules/weather/WeatherRules.js`
covers fog (heavy fog +1 to P and DE), dusk (+1), full and moonless night (+2/+3, reduced by
target heat), rain and snow, and wind against missiles and ballistics. It also drives MP per
hex (fog, darkness), rain PSRs (+1/+2) and the extreme-temperature heat per turn (+1 per 10C
above 50, -1 below -30). *M*
6.3 ✅ **Fire and smoke** (p63–64) — the Fire Table (plasma/inferno automatic, flamer 4+,
energy 7+, missile/ballistic 9+, with environment and temperature modifiers), ignition rolled
at the end of the phase from hexes hit during it, spread downwind on a 12 (two hexes in a
gale), smoke in the two hexes downwind, 2 CF per End Phase for a burning building, and 1D6
damage in the Heat Phase to units standing in fire. *M*

**Known gaps in Phase 6 so far:** illumination (searchlights) is not modelled, so night
modifiers always apply; the moonless-night physical attack bonus is implemented as a helper
but not wired into the physical resolver; extinguish-on-40-AE-damage is not wired because no
AE weapon exists in the data; smoke does not yet block line of sight. The "Effects of Fire"
procedure is now in the KB (p63, imported in the gap-fill) and the implemented reading —
+5 heat in the Heat Phase, +2 per burning hex entered, capped with weather and plasma —
follows that page.
6.4 ⚠️ **Hidden units** (p82) — per-player projection on the read path plus the p82 trigger
list: *fires* (hit or miss), *starts its own move*, an enemy *ends its move next to it* (this
reveals the hidden 'Mech, not the mover), an enemy *is ordered into its hex* (ground movement
stops in the previous hex; a jumping 'Mech lands there and reveals it), a 'Mech *moves into or
ends next to a building hex* (reveals every hidden 'Mech in that building, whatever level it
hides on), a hidden 'Mech in a mined hex *walks or runs out* (the field attacks it), and
minefield/area-effect damage. Jumping over a hidden 'Mech neither blocks nor reveals it, and
hidden 'Mechs revealed by enemy movement cannot move that phase. **Open:** point-blank shots on
reveal, active-probe detection at the end of the Movement Phase, hidden spotters, the
end-of-phase adjacency case for an enemy that never declares a move, jump-into domino
displacement (p55), and the skidding/dropping/displacement exceptions to the entry stop-short
rule. The p82 "Hidden 'Mechs" section is in the project KB (chunk 42), so the rules implemented
here come from that text.
6.5 ✅ **Minefields and battlefield support** (p75–79) — `src/rules/battlefield/Minefields.js`
handles the Light/Medium/Heavy densities (2D6 vs Target Number, 5-point Damage Value groupings),
the enter-a-mined-hex trigger (a jumping 'Mech only at its landing hex), depletion, and the
hidden-'Mech walk/run exit attack from p82. `src/rules/battlefield/BattlefieldSupport.js` books
Light/Heavy Strike, Light/Heavy Bombing (scatter on a miss), Strafing and Thumper/Sniper/Long
Tom artillery (blast rings), spends Battlefield Support Points, and resolves each strike in the
End Phase of its turn; scheduled strikes are filtered out of the opponent's projection.
Known simplification: the p79 minefield hit location is assumed (the KB has no p79 minefield
body), and defensive air cover, pre-plotted artillery hexes and strafing's five-hex line are
out of scope.
6.6 ✅ **Design quirks** (p82–95) — `src/data/quirks.json` carries nine negative quirks (Poor
Targeting short/medium/long, Sensor Ghosts, Inaccurate Weapon, Cramped Cockpit, Hard to Pilot,
Unbalanced, Poor Cooling Jacket) and `src/rules/quirks/Quirks.js` resolves them as pure
accessors wired into target numbers (`AttackResolver`), piloting skill rolls (`PSRCalculator`)
and heat (`GameEngine`); per-Mech quirks live on `unit.quirks`, and weapon-scoped quirks are
inert unless the fired weapon matches. **Coverage is thin:** only three units carry any quirk,
no **positive** quirk is implemented (the Atlas's canonical Battlefists, Command 'Mech,
Distracting and Improved Communications are all absent, and several need hooks the engine does
not have — initiative, enemy TN, physical attacks), the remaining negative table is not
transcribed, and quirks are per-unit rather than per-chassis. Quirk breadth should be planned
together with the chassis/variant restructure, which is what makes chassis-level quirks
inheritable.

**Size:** S–M each, independent, gated on 5.5 for the visibility-dependent ones.

---

## Phase 7 — From simulator to game (proposed)

7.1 **Save/load and replay** — needs R3; dice are already seeded by `gameId + turn` and
`GameEngine.actionLog` records every action, so a replay is nearly free. `main.js` has a
literal `// TODO: Implement load game`.
7.2 **Scenarios** — mission JSON with deployment zones, objectives, victory conditions and
turn limits; the force builder already collects players and maps.
7.3 **AI opponent** — heuristic bot over the deterministic engine: enumerate legal moves,
score by resulting TN and cover, choose fire and physical targets.
7.4 **Multiplayer** — authoritative Node server with a WebSocket room per game, `seq`-stamped
actions, per-player projections via R1, reconnect from snapshots, phase clocks. Solo play
keeps working by running the same engine in a Web Worker.
7.5 **Quality** — CI running tests plus the coverage floor, ESLint/Prettier, `checkJs`,
dirty-rect rendering, mobile layout.

---

## Phase 8 — Elevation and the remaining urban work  ← next after the data restructure

The building rules are written but not fully playable: `position.level` exists and combat
honours it, yet **no movement path writes a floor**, so every 'Mech defaults to "inside at
level 0" and roofs exist only when a test or scenario edits the state directly. This phase
makes roofs and upper floors part of play.

8.1 **Floor model** — `position.level` is the building floor (0 = ground floor inside,
1..levels-1 = upper floor, `levels` = roof), matching the model `Buildings.js` already uses.
Movement sets it: entering a building hex at ground level, climbing one floor per level
change (MP and PSR per p17/p54), landing on a roof only when a jump ends there, and the
existing basement path dropping to a lower floor.
8.2 **Elevation in combat** — LOS and the p72 modifiers use the floor levels that are
already implemented; a ground-floor occupant and a roof occupant interact exactly as p72
allows; CF absorption stays inside-only (already done).
8.3 **Rendering and UI** — floor/roof affordances in the movement preview and renderer so a
player can see and choose the floor being entered.
8.4 **C-10** — when partial cover is a building and the hit location is a leg, the attack
must damage the building (p26/p32), not simply be discarded.

Acceptance: through `processAction` alone, a 'Mech can walk into a building, climb to its
roof, be shot at on the roof with the p72 modifiers, and drop through a basement — with no
direct state editing.

**Size:** L (8.1-8.2), S (8.3-8.4).

## Phase 8b — Indirect fire polish (era-neutral)

- **Spotter declaration restriction** — a spotter that charged or launched a DFA may not
  spot (p30); needs per-turn declaration state that the engine does not track yet.
- **Aimed shots against partial cover** — the interaction of an aimed shot with cover is
  only partly implemented (sweep C-11/C-12); p30 has a body in the KB now.
- **Hidden 'Mech spotting hook** — hidden units may spot (p82); the visibility layer exists,
  the hook does not.
- **TAG / Narc / Artemis IV** stay **era-gated** (3040s-3050s technology) until the roster
  moves past 3025; the sketch is in Phase 4.

**Size:** S-M each.

---

## Recommended next slice

Order of work from here:

1. **Close the residual wave** — commit it behind the review verdict and write the closure
   matrix (fixed / partial / deferred for all 162 sweep findings).
2. **Chassis/variant restructure** — the roster is frozen until it lands; it unblocks bulk
   import and chassis-level quirks.
3. **Phase 8a elevation** — retires the last structural gap in the building rules.
4. **Phase 8b indirect polish + C-10** — small and era-neutral.
5. **Data hygiene** — `chassisId`, derived structure/MP, slot-format compression.
6. **Phase 7 features** — scenarios, save/load, AI, multiplayer, CI.

Phase A dead wiring (movement heat, skidding, MASC activation, 20+ damage PSR) is still
accepted debt; it moves up if the priority shifts from breadth to play-depth.
