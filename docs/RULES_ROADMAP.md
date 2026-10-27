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
| **LOS height / partial cover** | ❌ wrong model | LOS compares hex heights only; no 2-level 'Mech height |
| **Partial cover hit rule** | ❌ missing | +1 TN applied, but leg hits are not negated (p26) |
| **Prone target modifier** | ❌ wrong | flat −4; rule is −2 adjacent / +1 otherwise (p28) |
| **Pilot damage** | ❌ dead code | `pilot.hits` is read in `PhaseManager` but never incremented |
| **Actuator / hip / shoulder crits** | ❌ no effect | `DamageResolver` has engine, gyro, sensors, life support, sinks only |
| **Physical attack TN table** | ❌ wrong | piloting + ad-hoc modifiers; no kick −2, no comparative piloting (p38) |
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

### 1.2 'Mech height in LOS (`LineOfSight`, p22)

- Add `Unit.getLOSLevel()` = hex level + 2 standing / + 1 prone.
- Use LOS level (not hex level) for the attacker, the target and the intervening-hex
  comparisons. `getHeight()` stays for terrain only.

Acceptance: a 'Mech on Level 0 can see over a Level 1 hill it could not see over before;
a prone 'Mech behind a Level 1 hex is not visible to a Level 0 attacker.

### 1.3 Partial cover, corrected (p26)

Current test `ihex.level >= targetHeight + 2` over the last two hexes is wrong. Rule:
target standing, adjacent to a hex **one level higher than the target's hex**, that hex
lies along the LOS, and the attacker's LOS level is **≤** the target's. Prone targets get
none. Depth-1 water always gives it.

### 1.4 Partial cover hit rule (p26, p32; misconception 8, p130)

With partial cover, if the hit location is a leg the attack strikes the cover: damage the
building if it is a building, otherwise no damage. **Do not re-roll** and **do not** use
the punch table — that is the pre-2006 rule.

### 1.5 Target state modifiers (p28)

Replace the flat prone −4 with −2 adjacent / +1 otherwise; add attacker-prone +2 to fire;
skidding +2 as a target and +1 to fire.

### 1.6 Attacker damage modifiers (p28) — currently "omitted for simplicity"

Sensor hit +2. Shoulder hit: no arm weapons, +4 for arm weapons regardless of other
actuators. Upper/lower arm actuator +1 each for weapons in that arm.

### 1.7 Multiple targets (p27)

First target free; each secondary target +1 if in forward arc, +2 if side/rear.

### 1.8 Twist and flip as declared actions (p24–25)

`PhaseManager` already resets both each turn; wire them up:
- Torso twist ±1 hexside during the weapon attack phase (shifts arcs, not facing).
- Arm flip only if no hand/lower-arm actuators in either arm and no split locations;
  cannot twist and flip in the same turn; returns to front in the End Phase.

### 1.9 Rear-mounted weapons

`med_laser_rear` exists in `weapons.json` with no `mount` field. Add `mount: "rear"` and
enforce via 1.1.

**Size:** L (roughly 3 PRs). **Tests:** new `tests/rules/combat/ArcRules.test.js`, plus
LOS, partial cover and modifier cases in the existing suites.

---

## Phase 2 — Pilot and damage continuity (p41–49, p52, p58)

2.1 **Pilot damage sources** — head hit, fall, ammo explosion, life-support heat, hull
breach, ejection. `pilot.hits` must actually move.
2.2 **Consciousness ladder** — 3+/5+/7+/10+/11+/dead per hit; current array
`[0,3,5,7,10,null,null]` treats the 5th hit as automatic unconsciousness.
2.3 **Critical hit effects** — hip (½ MP, no kick, +2 PSR), upper/lower leg actuator,
foot actuator, shoulder, upper/lower arm actuator, hand actuator, sensors (+2 TN),
life support (heat damage), engine heat (+5 then +10/turn).
2.4 **PSR modifiers from crits** — gyro +3 (code currently adds 1 per hit), +2 per hip,
leg actuators, foot.

2.5 **Heat consequences** — an ammo explosion destroys *one* critical slot (the most
destructive ammo per shot, then most shots remaining), not every bin; it inflicts 2 points
of MechWarrior damage; an involuntary shutdown forces a PSR at +3; a shutdown 'Mech is
immobile and auto-fails PSRs.

**Size:** M–L. **Why second:** it makes every existing damage result visible, and Phase 1
item 1.6 needs the actuator state anyway.

---

## Phase 3 — Physical attacks (p34–40)

3.1 TN table: punch 0, kick −2, push −1, club −1, DFA 0 (+3 jumping), charge comparative
piloting-skill modifier.
3.2 Legality: forward arc for kick/charge/push/club, arm/arc pairing for punches, the
Different Levels table (p34), prone exceptions.
3.3 Damage: punch 1/10 tons, kick 1/5, club 1/5, charge tonnage/10 × hexes charged
(target hex excluded), DFA.
3.4 Consequences: missed kick → PSR; successful kick → target PSR; charge → both PSR +2;
DFA landing.
3.5 Physical weapons (hatchet, sword, mace, claws) from the p38 table, including the
"no firing arm weapons and physical attack with the same arm" restriction.

**Size:** M.

---

## Phase 4 — Indirect fire and spotting (p30–31)

Spotter declaration, +1 indirect modifier, spotter movement and terrain from the
spotter's LOS, cannot fire indirectly with LOS to the target, aimed shots vs immobile.

**Size:** M. Needs Phase 1 arcs and LOS height.

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

1.1 is in. **Phase 1.2 + 1.3 are next**, rules-only and headless:

1. `Unit.getLOSLevel()` and the LOS rewrite (2 levels standing, 1 prone).
2. Partial cover detection (adjacent hex one level higher, along the LOS,
   attacker's LOS level not higher) and the leg-hit-negation rule.

Then 1.5–1.9 in the following PR, with the twist/flip declaration UI last
(`torsoTwist` and `armsReversed` already drive the arc rules once something
sets them).
