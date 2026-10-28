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

Building type/CF/levels, damage to buildings, movement PSRs and MP costs, basements,
collapse, combat within buildings. `Hex.building` already carries `type/levels/cf`.

**Size:** L. Only worth it once the open-field game is correct.

---

## Phase 6 — Optional layers (p61–64, p75–95)

Weather and planetary conditions, fire/smoke, hidden 'Mechs (stubs exist in
`GameState.hiddenUnits`), minefields and battlefield support, design quirks (a clean
data-driven win — the tables are already in the KB).

**Size:** S–M each, independent, best done after the core is trustworthy.

---

## Recommended next slice

1.1–1.4 are in. **1.5–1.7 are next** (target state modifiers, attacker damage modifiers,
multiple targets), then 1.8–1.9 with the twist/flip declaration UI last — `torsoTwist`
and `armsReversed` already drive the arc rules once something sets them.
