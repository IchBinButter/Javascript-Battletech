# Rules Roadmap — what to implement next

Plan derived from the BattleMech Manual (7th printing) in the knowledge base and an
audit of the current engine. Page references are BMM pages.

## Where the engine actually stands

| Area | State | Evidence |
|---|---|---|
| Heat scale (MP / TN / avoid targets) | ✅ complete | `src/data/heatScale.json`, `src/rules/heat/HeatScale.js` |
| Heat *consequences* | ❌ partial | ammo explosion drains every bin; should be one slot (p52) |
| MP / TSM / MASC | ✅ complete | `src/rules/movement/maxMP.js` |
| GATOR movement + range + heat + woods | ✅ matches p28 | `AttackResolver.calculateTargetNumber` |
| Cluster hits, hit location, kick/punch tables | ✅ matches p33/137 | `src/data/hitTables.json` |
| **Firing arcs** | ✅ 1.1 done | `src/rules/combat/ArcRules.js`, enforced in `AttackResolver` and `GameEngine` |
| **LOS height / partial cover** | ✅ 1.2/1.3 done | `Unit.getLOSLevel`, `LineOfSight` rewritten against p22/p26 |
| **Partial cover hit rule** | ✅ 1.3 done | leg hits strike the cover and do no damage (p26/p32) |
| **Prone target modifier** | ✅ p28 | −2 adjacent / +1 otherwise |
| **Pilot damage** | ✅ p58 | head hits, falls, ammo explosions, life support heat; 3/5/7/10/11/dead |
| **Actuator / hip / shoulder crits** | ✅ p47-49 | weapon and physical modifiers, hip MP, sensors +2, engine heat |
| **Physical attack TN table** | ✅ p137 | punch 0, kick −2, push −1, charge/DFA comparative, actuator damage p29 |
| **PSR modifiers** | ✅ mostly p54 | 20+ damage +1, water −1/0/+1, woods +1/+2, charged/DFA +2; terrain and skid tables pending |
| Indirect fire / spotting / TAG | ❌ absent | p30–31 |
| Buildings / urban | ❌ stub | `Hex.building` exists, nothing damages it |
| Weather, fire, hidden, mines, quirks | ❌ absent | p61–89 |

The pattern: **tables and dice are faithful; geometry and consequences are not.**
Any weapon can shoot in any direction, a 'Mech's arm can be shot off with no effect on
its shooting, and a MechWarrior can never be hurt. Those three gaps are the difference
between a dice calculator and a game.

---

## Phase 1 — Combat geometry (BMM p22–30)  ← recommended next

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

Still open: TAG designation and Narc spotting (no equipment data for either), the Artemis
bonus suppression (no Artemis in the data), and the rule that a spotter may not have
charged or launched a DFA that turn (needs declaration tracking).

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
(light 0, medium +1, heavy +2, hardened +3), the hex takes `ceil(tonnage/10)` whatever the
roll, and a failed roll costs the 'Mech the same damage. Jumping onto a building does
neither.
5.3 ✅ **Collapse** — a hex at CF 0 becomes rubble and its occupants take
`ceil((CF at phase start / 10) x (1 + levels above))`; losing more than half a building's
hexes brings the rest down. Collapse from attack damage resolves at the end of the Weapon
Attack Phase.
5.4 ✅ **Combat within buildings** — +1 TN for a target inside a building, +1 per
intervening building hex (capped at +3), line of sight blocked beyond two, and each hit
reduced by `ceil(currentCF/10)` with the absorbed damage charged to the hex.
5.5 ✅ **Basements** — the 2D6 Basements Table is rolled once per hex per scenario on
first Level-0 entry; a basement drops the 'Mech 1–2 levels for `tonnage/10 x (levels + 1)`
falling damage, prones it, and the building hex takes `tonnage/10` (double for a two-level
basement). A 'Mech heavier than the hex's CF at the start of the phase falls through even
when the roll says no basement.

**Known simplifications:** units have no elevation, so "inside at Level 0" is assumed and
roof movement is deferred; collapse damage uses the standard front hit table rather than
the Punch table (p73); the adjacent-attacker exception for missed shots is not implemented;
building CF damage is applied immediately even though collapse waits for the phase end;
the Facing After Fall Table is not rolled for a basement fall.

**Size:** M–L. **Multiplayer:** building CF is public state, so it rides in the patch — but
the damage-routing events must be JSON-safe (see R4).

---

## Phase 5.5 — Multiplayer readiness (retrofit, before 6.4 and 7.4)

The rules are player-agnostic and the engine is already DOM-free, so phases 1–4 do not need
revisiting. The plumbing does, while the codebase is still small:

- ✅ **R1 Visibility seam** — `src/engine/visibility.js` provides `canSee` and
  `projectStateForPlayer`; the engine refuses to fire at a hidden unit, and the projection
  keeps the GameState prototype so the UI can keep calling its helpers. Still to do: route
  the renderer and UI through the projection once hidden units ship (6.4).
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

---

## Phase 6 — Optional layers (p61–64, p75–95)

6.1 **Terrain modifiers** — `terrain.json.modifiers` already carries MP multipliers and PSR
values for ice (4), mud (1) and deep snow (1); wire them into movement and PSR. *S*
6.2 **Weather and planetary conditions** (p62–63) — `state.weather` exists but nothing reads
it; fog/rain/snow/dusk/night, wind against missile and ballistic fire, heat from temperature.
6.3 **Fire and smoke** (p63–64) — ignition from flamers and area-effect damage, spread
downwind, 1D6 damage for standing in fire, smoke blocking LOS. The state and decay already
exist; nothing ever ignites one.
6.4 **Hidden units** (p82) — build on R1: per-player projection, detection by proximity and
probes, point-blank shots on reveal, hidden spotters.
6.5 **Minefields and battlefield support** (p75–79) — `state.minefields` and
`state.battlefieldSupport` exist unused; mine triggers, artillery and air strikes.
6.6 **Design quirks** (p82–95) — data-driven quirk table with per-Mech data; the refits are
the natural place to start.

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

## Recommended next slice

1.1–1.4 are in. **1.5–1.7 are next** (target state modifiers, attacker damage modifiers,
multiple targets), then 1.8–1.9 with the twist/flip declaration UI last — `torsoTwist`
and `armsReversed` already drive the arc rules once something sets them.
