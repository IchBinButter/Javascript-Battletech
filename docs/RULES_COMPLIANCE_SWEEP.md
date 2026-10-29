# Rules Compliance Sweep — BattleTech Manual

**Team:** `rules-compliance-sweep` · **Captain:** team captain · **Synthesis:** t7 (`synthesizer`)
**Date:** 2026-10-29 · **Revision:** 2 (review round 1 corrections, t9)
**Scope:** every `src/rules/**` module, plus the data, import and export layers those modules consume.
**Manual:** *BattleMech Manual* (BMM), consulted through the project knowledge base (`battlemechmanual.pdf`, category “Battletech”). Page numbers in findings are BMM page numbers.
**Method:** six read-only module audits (t1 movement, t2 combat, t3 physical/urban, t4 heat/pilot/sequence, t5 battlefield layers, t6 data/import-export), followed by this consolidation. No code, test or git state was changed. **No tests were run during the sweep**, so “pinned by” references are static readings of the test source, not assertions that the test currently passes.

> **KB coverage caveat.** The knowledge base stores page-level chunks, and many BMM page bodies are missing. t4 found most odd pages in its range absent (p51 is missing), although some spreads include the facing page (e.g. the p16 chunk contains p17's Movement Costs Table); t3 lacked p34–p35, p37, p39–p40, p67 and p71; t5 lacked p77, p79, p75, p63 and p61; t6 lacked the SRM launcher and ECM rows. Every quoted sentence below comes from a page the auditor could actually read. Rules that could not be quoted are collected in §4 as *unverified* or *assumption*, never as citations.

**Severity scale.** **Blocker:** a core rule is systematically wrong or absent and the game plays incorrectly; fix before the next rules release. **High:** a rule is wrong or missing in a way that changes outcomes. **Medium:** a narrower rule/data defect or a missing optional rule. **Low:** dead code, cosmetic, evidence or documentation defect.

---

## 1. Summary

Counts are of **active, distinct findings after consolidation and the review-round corrections** (see the counting notes below).

| Domain | Blocker | High | Medium | Low | Total |
|---|---:|---:|---:|---:|---:|
| 3.1 Movement, terrain & PSR (t1) | 5 | 15 | 14 | 2 | 36 |
| 3.2 Weapon attack, LOS, arcs & damage (t2) | 2 | 6 | 9 | 10 | 27 |
| 3.3 Physical attacks & urban combat (t3) | 0 | 6 | 14 | 9 | 29 |
| 3.4 Heat, MechWarrior & phase sequence (t4) | 1 | 8 | 9 | 7 | 25 |
| 3.5 Battlefield layers (t5) | 0 | 0 | 18 | 8 | 26 |
| 3.6 Data, import & export (t6) | 0 | 4 | 8 | 7 | 19 |
| **Total (active)** | **8** | **39** | **72** | **43** | **162** |

Plus **1 withdrawn finding** (M-04, kept in §3.1 for audit history) and the coverage-only notes in §3.7; neither changes the active totals above.

**Counting notes.**

- Raw audit tallies sum to **167** findings: **12 blockers, 41 high, 72 medium, 42 low**. Four duplicate entries in that tally are counted once under their canonical finding: **D-03** (→ C-01), **D-04** (→ PHY-01), **F-01** (→ H-03) and **M-29** (→ BLD-01).
- t3's cross-module **X-01** is a fifth duplicate heading (also → C-01) but was never part of t3's 29-item count, so the document contains **168 finding headings**: 167 raw + X-01. 168 − 5 duplicates = **163 distinct**; after withdrawing M-04, **162 active findings**.
- Review round 1 (t8) changed the counts: **M-04** withdrawn (false blocker), **M-05/M-06/M-09** blocker → high (dead/unreachable code), **C-05** high → low (latent map defect), **M-13** high → medium (unverified derivation). The table above is the post-review active count.
- t6's two **“high-blocking”** findings (D-01, D-02) are counted in High; D-05 and D-06, labelled “medium-high” in the t6 report, are also counted in High, matching t6's own tally (2 high-blocking + 4 high).
- t5's tally line says 14 medium / 6 low, but its finding list contains **18 medium / 8 low**; this report uses the counted values.
- **D-13** is a compound data finding. Its water-depth2, swamp, ice/mud/snow and hardened-PSR items restate M-01, M-31, M-37 and BLD-01; it is still counted once in §3.6 because of its unique rubble-height and missing-terrain items.
- `src/engine/EventBus.js`, `src/engine/StateManager.js` and `src/rules/heat/HeatScale.js` are covered by the check notes in §3.7 (no findings).

---

## 2. Top 10 priorities

The **eight active blockers** are covered by priorities 1–5. Priorities 6–10 are the highest-impact non-blockers. Corrected totals: **162 active findings — 8 blockers, 39 high, 72 medium, 43 low**, plus 1 withdrawn (M-04). (Review round 1 withdrew M-04 and downgraded the dead-code skid/MASC paths; see §2.1.) Each item names the concrete fix; full evidence and quotes are in the domain sections.

### P1 — C-01 · Blocker · Left/right hit-location columns are the front column and its mirror

- **Manual:** p139 ’Mech Hit Location Table, columns *Left Side | Front/Rear | Right Side*: “2* Left Torso [critical] | Center Torso [critical] | Right Torso [critical]; 3 Left Leg | Right Arm | Right Leg; … 12 Head | Head | Head.”
- **Code:** `src/data/hitTables.json:39-74` (`left`) is `front` verbatim; `:75-110` (`right`) is its mirror; called through `AttackResolver.resolveAttack` → `determineHitLocation(locRoll, getAttackDirection(...))` (`AttackResolver.js:357-360`, table lookup `:403-415`). Duplicates: D-03 (data), X-01 (physical weapons).
- **Impact:** a left-side attack hits the left torso on roll 8 only (**5/36**); the manual also puts LT on rolls 2 and 7, for **7/36**. Roll 2 never crits the near-side torso, and side-arc hits are resolved on the wrong column.
- **Fix:** replace both columns with the p139 rows (Left Side: 2 LT, 3 LL, 4 LA, 5 LA, 6 LL, 7 LT, 8 CT, 9 RT, 10 RA, 11 RL, 12 Head; Right Side mirrored), set `critical` on roll 2, and rewrite `tests/rules/combat/HitTables.test.js:74-179` against p139.

### P2 — C-02 · Blocker · Rear attacks use an invented rear table, and its `isRear` flags bypass limb armour

- **Manual:** p139 has exactly three columns and the middle is labelled “Front/Rear”; p44: “Damage to a missing arm or leg transfers to the torso on the same side … Additional damage to a destroyed side torso location transfers to the center torso”; p42: rear damage uses rear torso armour.
- **Code:** `hitTables.json:111-156` defines a separate `rear` table that is **not a copy of the front column** (it differs at roll 4 — leftTorso vs leftArm — and roll 6 — centerTorso vs leftTorso) and marks every entry except the head `isRear: true`; `DamageResolver.js:44-55` reads `armorLoc.rear || 0`, so rear arm/leg hits skip 34–41 points of armour and go straight to internal structure — **rolls 3, 5, 9, 10, 11 = 15/36 of rear hits**. `BattlefieldSupport.js:282` uses the same table.
- **Fix:** delete the `rear` table; use the front column for rear attacks, with `isRear` only on center/left/right torso; pass `isRear` through `DamageResolver` transfer.

### P3 — M-01 + M-02 + M-03 · Blockers · Movement cost table is absolute instead of additive, descending is free, and pavement erases level/modifier costs

- **Manual:** p17/p136 Movement Costs Table: “Water Depth 1 +1† (Level change MP cost not included) Depth 2+ +3†”; “Level change (up or down) 1 level +1 — 2 levels +2”; p20: “’Mechs traveling on roads pay only 1 MP per hex; however, any MP costs for changing levels are still required”; p128 example: entering Depth 1 from Level 0 costs **3** MP, Depth 2 from Level 0 costs **6** MP.
- **Code:** `MovementCalculator.js:16-21` stores water as absolute 2/3 MP; `:51-57` adds `levelDiff` only when positive; `:72-75` sets pavement cost to 1 after all additions.
- **Fix:** store additive terrain costs (`depth1: 1`, `depth2+: 3`, `water_depth3`), always add `Math.abs(levelDiff)` for 1–2 levels (3+ is illegal or a fall), and make pavement/road a +0 modifier that preserves level-change, ice/mud/snow and weather costs.

### P4 — M-07 + M-08 · Blockers · MP derivation ignores destroyed legs and mishandles hips

- **Manual:** p44: a one-legged ’Mech is reduced to 1 Walking MP and cannot run; p48: a hip hit halves Walking MP (round up) and Running MP is recalculated ×1.5 (round up); two hips reduce MP to 0.
- **Code:** `maxMP.js:21-56` never checks for a destroyed leg; the hip block only runs in walk mode, so a two-hip ’Mech still gets full running MP.
- **Fix:** one pipeline — heat penalty → hip halving → leg loss (walk 1 / run 0) → `run = Math.ceil(walk × 1.5)`; two hips → all MP 0. Update the tests that pin the opposite.

### P5 — H-01 · Blocker · Movement heat is never generated

- **Manual:** p50: “Walking generates 1 heat point … Running generates 2 heat points … Jumping … 1 heat point per Jumping MP expended, with a minimum of 3.”
- **Code:** `HeatManager.calculateHeatGeneration()` has no production caller; the only `heat +=` in `src/` is weapon heat at `GameEngine.js:496`. Walking, running and jumping never add heat.
- **Fix:** call the generation function from the turn pipeline (movement confirmation or Heat Phase), or add movement heat in `_handleMove`; add an integration test “walk → heat phase records +1”.

### P6 — D-01 · High (high-blocking) · `small_laser` is used by four roster units but missing from `weapons.json`

- **Manual:** p121: Small Laser heat 1, damage 3, 0/1/2/3, 0.5 t, 1 crit.
- **Code:** `mechs.json:4182, 4239, 4561, 4565, 5839, 6290, 6400, 6854, 7568, 8019` reference `small_laser`; `weapons.json` has no entry. Both UI paths guard the lookup — `main.js:327` and `src/ui/UIController.js:189` do `if (!weaponDef) continue;` — so the weapon is **silently skipped and cannot fire**; there is no exception, and `GameEngine.js:464` is never reached with `undefined`.
- **Fix:** add the p121 entry and a data-integrity test that every `equipment.weapons[].type` resolves in `weapons.json` (the same test catches D-02).

### P7 — PHY-01 · High · Punch and kick hit locations are fabricated 2D6 tables; the manual uses 1D6 with three columns

- **Manual:** p38: “Determine the damage location by rolling 1D6 and consulting the appropriate column of the Kick Location Table”; p139/p140: punch 1D6 — 1 Left Torso | Left Arm | Right Torso … 6 Head; kick 1D6 — 1–3/4–6 legs, with left-side/front/rear/right-side columns.
- **Code:** `PhysicalAttackResolver.js:264, 315, 362, 404, 517` roll 2D6 and index invented 11-entry tables at `hitTables.json:157-226`; head is 5.6 % instead of 16.7 %, and side columns do not exist. Duplicate: D-04.
- **Fix:** store 1D6 tables keyed by direction, roll 1D6 in the resolver, and rewrite `PhysicalAttackResolver.test.js:38-89` from p140 instead of copying the JSON.

### P8 — H-04 + H-05 · High · Consciousness, death and removal are broken

- **Manual:** p58: a Consciousness Roll is made immediately on each point of damage; 6 points of damage is dead; p44: head destruction kills the MechWarrior; p12: consciousness rolls are made after attacks, and the End Phase is for *recovery*.
- **Code:** `PhaseManager.js:281-313` rolls every End Phase for **conscious** pilots, never at damage time, and an unconscious pilot can never wake (the guard requires `conscious === true`). `applyPilotDamage` sets `pilot.dead` but nothing reads it; head destruction sets `unit.destroyed` but not pilot death, and destroyed units are never removed (also H-14).
- **Fix:** roll consciousness when damage is taken (or at the end of the attack phase), make the End Phase roll recovery-only for unconscious pilots, use one kill path (6th hit / cockpit crit / head destruction), and emit unit removal.

### P9 — C-03 · High · Cluster damage is not split into Damage Value groupings

- **Manual:** p32/p96: SRM = 2-point groupings; LRM/MRM/ATM = 5-point groupings; one hit-location roll per grouping.
- **Code:** `AttackResolver.js:348-394` rolls one location per missile, so an LRM-20 can produce 12 one-point hits, 12 critical/TAC chances and up to 12 pilot hits instead of 3 groupings.
- **Fix:** build groupings by weapon class (SRM 2 / LRM-MRM-ATM 5) and roll one location per grouping.

### P10 — H-06 + H-14 · High · Shut-down, unconscious and destroyed ’Mechs can still act

- **Manual:** p52/p58: a shut-down or unconscious ’Mech is immobile and cannot attack or act; p10/p131: destroyed ’Mechs are removed from the map and the action queue.
- **Code:** `PhaseManager.validateAction` and `buildUnitQueue` never check `shutdown`, `pilot.conscious` or `isDestroyed()`; `GameEngine._handleFire`/`_handleMove` have no shutdown check; destroyed units are never removed.
- **Fix:** derive `immobile` from shutdown/consciousness, reject move/fire/physical actions for immobile units, and remove destroyed units at the end of the phase in which they die.

### 2.1 Next tier and review-round changes

11. **C-06 / C-07** — critical hits: no 2-/3-crit bands, no blown-off limb/head, no 1–3/4–6 block and slot re-roll (p46/p143).
12. **C-09** — weapon fire is never validated against mounted/destroyed weapons, one-shot-per-turn, or ammo bins (p24/p48).
13. **H-07** — restart is a flat 8+ in the End Phase; no auto-restart below 14, no block at 30+ (p52).
14. **H-02** — engine-critical heat is never applied (p50).
15. **H-03** — fire/external heat never reaches the Heat Scale; the 15-point outside-heat cap is missing (p50).
16. **BLD-02** — combat within buildings ignores levels for LOS and modifiers (p72).
17. **PHY-02** — the Different Levels table is inverted for kick and punch (p140).
18. **M-05 / M-06** — skid length/damage formulas are wrong, but `SkiddingRules` is **dead code** (M-14); high/latent, only a blocker if the path is wired.
19. **M-09** — MASC doubles walking instead of running, but `activateMASC` has **no caller** (M-19); high/latent.
20. **M-13** — heat is subtracted from run MP as a flat penalty instead of recomputing run from walk; the recompute rule is **unverified** (§4.4), so medium.

**Withdrawn/downgraded in review round 1 (t8):** **M-04 withdrawn** — `min(diff, 6 - diff)` is the correct hexside count under p14 and p143, not a bug; **M-05/M-06 and M-09** blocker → high (dead/unreachable code); **C-05** high → low (latent map defect masked by the arm-destroyed guard); **M-13** high → medium (run-MP derivation unverified). Full rows remain in §3 with `WITHDRAWN`/`DOWNGRADED` markers.

---

## 3. Findings by domain

Each subsection reproduces the auditor's findings in the auditor's ranking and wording, with ids, `file:line` references, manual quotes and recommended fixes. “Pinned by” names the test that currently locks the behaviour in place. Consolidated duplicates are marked at the top of the domain and at the finding.

## 3.1 Movement, terrain and PSR (t1)

**Audited:** `src/rules/movement/{MovementCalculator,SkiddingRules,maxMP,TerrainRules,PSRCalculator}.js`, `src/hex/HexMath.js`; cross-checks to `src/data/{terrain,equipment}.json`, `src/models/{Hex,Unit}.js` and `GameEngine` call sites.
**Counts:** 5 blockers, 15 high, 14 medium, 2 low (M-29 consolidated into BLD-01; M-04 withdrawn; M-05/M-06 and M-09 downgraded to high/latent; M-13 downgraded to medium).
**KB pages used:** p14, p16–p18, p20, p22, p26, p44, p48, p52, p54/p142, p56, p58, p60, p62, p64, p68, p70, p74, p116, p128, p132, p136/p17 (see Appendix A).
**Severity grouping:** the body keeps the auditors’ original order; review-round changes are marked on each finding (M-04 withdrawn; M-05/M-06/M-09 and M-13 downgraded), and the §1 counts use the revised severities.

### Blocker
#### M-01 · blocker · src/rules/movement/MovementCalculator.js:16-21, 51-57
- Manual (p17/p136 Movement Costs Table): "Water Depth 1 +1† (Level change MP cost not included) Depth 2+ +3† (Level change MP cost not included) … Level change (up or down) 1 level +1 — 2 levels +2". p128 worked example: "entering Depth 1 water from a Level 0 hex costs 3 MP. It always costs 1 MP to enter any hex. In addition, it costs 1 MP for changing from Level 0 to Depth 1, and 1 MP to enter a Depth 1 water hex." and "Depth 2 … 1 MP to enter any hex, 2 MP for changing two levels … 3 MP for entering a Depth 2 water hex. Total MP spent = 6 MP."
- Code: `water_depth1: 2`, `water_depth2: 3` as *absolute* costs and levelDiff is only added when `levelDiff > 0` (line 55-57). Entering Depth 1 from Level 0 costs 2 (manual 3); Depth 2 costs 3 (manual 4 before level change, 6 from Level 0). There is no Depth 3+ type at all.
- Pinned by: tests/rules/movement/MovementCalculator.test.js:108-118 ("water_depth1 costs 2 MP", "water_depth2 costs 3 MP") and tests/ui/MovementPreview.test.js:565-578.
- Fix: store terrain entries as additive "terrain cost" (`depth1: 1`, `depth2+: 3`) and always add the level-change cost (see M-02); add `water_depth3`.

#### M-02 · blocker · src/rules/movement/MovementCalculator.js:51-57
- Manual (p17/p136): "Level change (up or down) 1 level +1 — 2 levels +2".
- Code: `if (levelDiff > 0) cost += levelDiff;` — descending is free. A 'Mech can walk off a Level 2 hill into a Level 0 hex for 1 MP (manual 3 MP).
- Pinned by: tests/rules/movement/MovementCalculator.test.js:173-177 ("does not reduce cost for downhill") and :214-218 ("allows downhill of any magnitude").
- Fix: `cost += Math.abs(levelDiff)` for 1–2 levels; keep the 3+ prohibition (see cannot-verify note on p15) and treat drops >2 as falling/accidental fall rather than a normal move.

#### M-03 · blocker · src/rules/movement/MovementCalculator.js:72-75
- Manual (p20 Road Movement): "'Mechs traveling on roads pay only 1 MP per hex; however, any MP costs for changing levels are still required." Movement Costs Table (p17/p136) gives "Paved/Bridge +0" and "Road +0*" (road only if travelling along the road, otherwise the underlying terrain cost).
- Code: `if (toHex.terrainType === 'pavement') { cost = 1; }` after all additions, so it discards level-change costs *and* ice/mud/deep-snow/weather additions; there is no road-vs-underlying-terrain distinction.
- Pinned by: tests/rules/movement/MovementCalculator.test.js:185-189 ("pavement overrides level climb cost to 1").
- Fix: turn pavement into a +0 terrain modifier; only apply the flat 1 MP when the previous hex was also on the same road, and keep level-change/modifier costs.

#### M-04 · WITHDRAWN (was blocker; review R-01) · src/rules/movement/MovementCalculator.js:94-107 and 195-199
- Manual (p14 Facing): "Changing facing costs 1 MP per hexside. For example, … a 180-degree turn (three facings, from Hex A to Hex B) costs 3 MP." p143’s Facing After Fall Table names only 1/2 hexsides or “Opposite Direction” (3).
- Withdrawal (review R-01): ending 4 clockwise hexsides from the start is the same facing as 2 counter-clockwise hexsides, so `min(diff, 6 - diff)` is the correct hexside count, not an undercharge. The original proposed fix (`cost = diff`) would overcharge legal turns. The helper is also dead code per M-34.
- Original claim (withdrawn): 4–5-hexside turns were said to be undercharged and movement outside the front 3 hexsides undercosted; both claims were geometrically wrong.
- Status: **WITHDRAWN** — kept for audit history; not counted in totals.

#### M-05 · DOWNGRADED to high (latent; dead code) · src/rules/movement/SkiddingRules.js:42-49
- Latency (review R-03): M-14 records that `checkSkid`/`resolveSkid` have no caller in `src/`, so no skid rules run in play; this is a latent rules defect, not a live blocker.
- Manual (p68 Skidding): "A 'Mech skids for a number of hexes equal to the number of hexes it has moved in the turn so far (not MP spent), divided by 2 (round up)."
- Code: `resolveSkid(unit, remainingMP, …)` → `let totalHexes = remainingMP;` The skid length is the unspent MP, not ceil(hexesMoved/2). A 'Mech that fails at the end of its move (0 MP left) does not skid at all.
- Pinned by: tests/rules/movement/SkiddingRules.test.js:334-343 ("zero remaining MP → damage is 0"), :296-303 (passes 4/2 and expects 4/2 hexes).
- Fix: take `hexesMovedThisTurn` as the input and compute `Math.ceil(hexesMoved / 2)`.

#### M-06 · DOWNGRADED to high (latent; dead code) · src/rules/movement/SkiddingRules.js:90-97
- Latency (review R-03): as with M-05, `SkiddingRules` is dead code (M-14); the damage formula is wrong but unreachable in play.
- Manual (p68 Skidding Damage): "First calculate the 'Mech's fall damage. Then calculate its skid damage, which is one-half its normal falling damage, rounded up: multiply this result by the number of hexes it skid. Add together the damage from the fall and all hexes skid into one 'attack'." "It is always applied in 5-point Damage Value groupings." p68 worked example: 45 t "suffers 5 points of damage falling … and 3 points of damage per hex it enters during the skid (half the falling damage of 4.5, rounded up)".
- Code: `const damage = Math.floor(unit.tonnage / 10) * path.length;` — uses floor (should be ceil(tonnage/10)) and *full* fall damage per hex instead of half, rounded up; omits the initial fall damage from the total and never produces 5-point groupings. 50 t: code 5/hex, manual 3/hex; 55 t: code 5/hex, manual 3/hex (ceil(5.5)=6, ceil(6/2)=3).
- Pinned by: tests/rules/movement/SkiddingRules.test.js:291-316 ("damage = floor(tonnage/10) * hexesSkidded").
- Fix: `fall = Math.ceil(tonnage/10)`; `skidPerHex = Math.ceil(fall/2)`; return `fall + skidPerHex*hexes` as one damage value plus groupings of 5.

#### M-07 · blocker · src/rules/movement/maxMP.js:21-56
- Manual (p44 Leg Destruction): "A 'Mech with one leg is reduced to 1 Walking MP (this overrides all MP increases) and cannot run."
- Code: `getMaxMP` never checks for a destroyed leg. `isLegMissing()` exists only in PSRCalculator.js:219-221. A one-legged 'Mech keeps full walking and running MP (and TSM/MASC increases).
- Pinned by: none (no maxMP test for destroyed legs; maxMP has no dedicated unit-test file).
- Fix: if `isLocationDestroyed('leftLeg'|'rightLeg')`, walk = min(1, current) and run = 0, before/overriding MASC/TSM.

#### M-08 · blocker · src/rules/movement/maxMP.js:41-47
- Manual (p48 Hip): "its Walking MP is cut in half (round up; apply before any leg or foot actuator damage MP reductions). Recalculate its Running MP accordingly by multiplying the new Walking MP by 1.5, rounding up." "A critical hit to the second hip reduces the 'Mech's MP to 0".
- Code: the hip block is inside `if (movementType === 'walk')`; Running MP is untouched. With two hips, `mp = 0` only for walk — a 'Mech with two destroyed hips still gets full running MP.
- Pinned by: none (no maxMP test for hip hits).
- Fix: compute walking MP first (heat → hip halve → leg loss), derive run = ceil(walk×1.5) (see M-13); two hips → all MP 0.

#### M-09 · DOWNGRADED to high (latent; unreachable) · src/rules/movement/maxMP.js:32-35
- Latency (review R-03): M-19 records that `activateMASC`/`rollMASC` have no caller in `src/` or UI, so MASC can never be activated in a real game; the branch is unreachable.
- Manual (p116 MASC): "On a result of 3 or higher, the 'Mech can run that turn at a speed equal to double its current Walking MP." p14: "A 'Mech that has successfully activated MASC that turn … may run at up to twice its Walking MP."
- Code: `if (movementType === 'walk' && unit.mascActive) mp = Math.floor(mp * MASC.mpMultiplier)` — it doubles *walking* MP and leaves running MP at 1.5×walk. MASC therefore does nothing in run mode, and in walk mode gives 2×walk MP while the attack modifier stays "walked +1" instead of "ran +2" (p28) — a free speed/attack advantage.
- Pinned by: tests/rules/movement/MovementCalculator.test.js:477-498 ("walk MP is doubled when MASC is active", "run MP is NOT doubled by MASC") and tests/integration/equipment.test.js:290-302.
- Fix: leave walk MP unchanged; when MASC is active and run selected, run = 2 × current walking MP (TSM/heat applied first).

---

### High
#### M-10 · high · src/rules/movement/MovementCalculator.js:156-163, 227-237
- Manual (p18 Jumping): "A jumping 'Mech also ignores facing: it can jump in any direction for the same MP cost, regardless of its initial facing, and when it lands it chooses any facing desired."
- Code: `getValidMoves`/`validateMovement` add `calculateFacingChangeFromDirection(currentFacing, moveDir)` for every step regardless of movementType, so jumps pay facing costs; and `newFacing = moveDir` forces the landing facing to the direction of the last hop.
- Pinned by: tests/rules/movement/MovementCalculator.test.js:746-764 (jump tests only assert reach/cost, not facing).
- Fix: skip facing costs for jump; let the caller choose landing facing.

#### M-11 · high · src/rules/movement/MovementCalculator.js:145-178
- Manual (p18): "A jumping 'Mech ignores terrain (and other 'Mechs) in hexes it jumps over." "a 'Mech cannot enter a hex with a level higher than the sum of its current Jumping MP plus the level of the hex its jump began in." "A 'Mech may jump into the same hex it began the turn in, for 1 MP."
- Code: jump is generated by walking the neighbour graph with cost 1 and the same `occupiedBy` block as ground movement (line 151), so a jump can never pass over an occupied hex; there is no jump-height check at all; the start hex is offered at cost 0, not 1.
- Pinned by: tests/rules/movement/MovementCalculator.test.js:726-764 (models jumping as BFS; "getValidMoves with jump: max cost equals jump MP").
- Fix: generate jump destinations by range/shortest-path, not adjacent BFS; allow overflight of units/terrain; add the level ≤ JumpMP + startLevel landing check; start hex at 1 MP.

#### M-12 · high · src/rules/movement/MovementCalculator.js:38-42
- Manual (p14 Water): "'Mechs cannot enter a Depth 1 or deeper water hex while running (whether the 'Mech is already in water or not)." (Repeated p128 misconception 3.)
- Code: `calculateMPCost` only special-cases jump; nothing checks `movementType === 'run'` against water, and no other file in src has such a guard (grep shows WaterDepth only in HeatManager/LOS/renderer). Running into water is therefore legal.
- Pinned by: none.
- Fix: return Infinity (or a validation error) for run into water_depth1/2; keep running allowed from water to land and for facing changes in water.

#### M-13 · DOWNGRADED to medium (derivation unverified; review R-06) · src/rules/movement/maxMP.js:37-40
- Manual (p14 Critical Damage): "If damage reduces a 'Mech's Walking MP rating, the player must recalculate the 'Mech's Running MP rating." That sentence is about damage, not heat. p68’s diagram ("Walking MP of 6 and a Running MP of 9") and the p52 Hatamoto example (walk 4→3, run 6→5) are consistent with both a flat penalty and a recompute.
- Code: `mp -= getHeatEffects(unit.heat).movementPenalty` is applied directly to whichever mode was selected, so run loses the same flat penalty. E.g. walk 4/run 8 at −2: code gives run 6; a recompute would give ceil(1.5×2) = 3. Atlas walk 3/run 5 at −1: code run 4, recompute 3.
- Pinned by: tests/rules/movement/MovementCalculator.test.js:661-665 ("reduces run MP by the same penalties").
- Unverified: §4.4 records that whether heat reduces Run/Jump MP and how run is recomputed cannot be confirmed from the KB (p13/p51 absent). The p52 example is consistent with either reading.
- Fix: confirm p51 before changing the derivation; if p51 confirms the recompute, derive walk from heat/hip/leg and set run = ceil(walk×1.5); otherwise document the flat-penalty assumption.
- Status: **DOWNGRADED** high → medium in review R-06; the behaviour may be correct.

#### M-14 · high · src/rules/movement/SkiddingRules.js:15-35
- Manual (p68, repeated p20): "If a 'Mech using running movement makes a facing change in a paved hex at any point in the turn, and then attempts to enter a new hex in the same turn, before that 'Mech actually enters the hex the player must make a Piloting Skill Roll … to see if the 'Mech skids." The roll is modified by hexes moved so far (Skid Modifiers Table).
- Code: `checkSkid` returns willSkid=true for *any* running move whose origin hex is pavement or ice, with no facing-change precondition, no PSR roll and no skid modifier; it also invents `unit._rapidTurnHexsides >= 2` ("Rapid turn") which does not exist in the manual. Neither `checkSkid` nor `resolveSkid` has a caller in src (dead code; skidding never happens in play).
- Pinned by: tests/rules/movement/SkiddingRules.test.js:111-133 (ice/pavement trigger), :151-183 (rapid turn).
- Fix: track per-turn facing changes; trigger only after a facing change in a pavement hex followed by entering a new hex; roll PSR with the Skid Modifiers Table; delete `_rapidTurnHexsides`; wire into GameEngine.moveUnit.

#### M-15 · high · src/rules/movement/SkiddingRules.js:45-46
- Manual (p68): "The skid takes the 'Mech in the direction it was travelling before making the facing change that caused it to skid."
- Code: `const direction = unit.position.facing;` — the facing *after* the turn, i.e. the intended new direction. In-game this sends the skid the wrong way.
- Pinned by: tests/rules/movement/SkiddingRules.test.js:205-281 (passes the same value as facing and travel direction).
- Fix: store the pre-turn travel direction (previous hex → current hex) and pass it into resolveSkid.

#### M-16 · high · src/rules/movement/SkiddingRules.js:81-88
- Manual (p70 Interrupting a Skid—Terrain): "If a skidding 'Mech moves into a terrain hex (not including buildings, level changes, or water), other than clear and/or paved hexes, then that terrain reduces the distance it skids. For each such hex entered, subtract the Movement Points required to enter that terrain type from the remaining hexes to be skid."
- Code: instead of subtracting terrain cost, it *adds* `remainingMP` to the skid length on a failed PSR in ice/pavement hexes ("chain skidding"). That extension rule does not exist in the manual; and the actual terrain-reduction rule (e.g. light woods −2) is not implemented.
- Pinned by: tests/rules/movement/SkiddingRules.test.js:460-608 (whole chain-skidding suite, e.g. "extends skid on ice when PSR roll < piloting").
- Fix: delete the chain-skid extension; subtract the terrain's MP cost from remaining hexes and stop in the hex that reaches 0.

#### M-17 · high · src/rules/movement/SkiddingRules.js:49-88
- Manual (p68, p70): "After a skid, the 'Mech's movement ends, even if it had MP remaining." "If a 'Mech skids off the playing area, it is considered destroyed for the remainder of the scenario." "If the level of the hex to be entered is two or more lower … the 'Mech … automatically falls in that hex." "if the level … is one or more higher … the skidding 'Mech automatically crashes into it and stops." "Water: 'Mechs automatically end their skid if they enter Depth 1 or deeper water."
- Code: `resolveSkid` handles only occupied-hex and building collisions; it ignores level changes, water, map edge and the "movement ends" rule; the skid simply stops when the array/MP runs out.
- Pinned by: none (no tests for level/water/edge skid interruptions).
- Fix: add level-delta handling (fall/crash), water end, off-map destruction, and report `movementEnds: true`.

#### M-18 · high · src/rules/movement/SkiddingRules.js:15-35 + src/rules/movement/PSRCalculator.js:35-41
- Manual (p68 Skid Modifiers Table): "0-2 –1; 3-4 0; 5-7 +1; 8-10 +2; 11-17 +4; 18-24 +5; 25+ +6"; p142 lists "Running after facing change while on pavement — See Skidding, p.68".
- Code: no Skid Modifiers Table anywhere; PSRCalculator models skidding as a trigger with `baseModifier: 0` (and a non-manual "Rapid Turn (Running)" trigger with 0). A skid PSR is always at the raw piloting number.
- Pinned by: tests/rules/movement/PSRCalculator.test.js:396-414 ("detects skidding" 0; "rapid turn" 0).
- Fix: implement `skidPSRModifier(hexesMoved)` and raise the skid PSR with that modifier; remove the Rapid Turn trigger.

#### M-19 · high · src/rules/movement/MovementCalculator.js:259-318 (+ src/data/equipment.json:49-56)
- Manual (p116 MASC): "its controller immediately rolls 2D6 (before the 'Mech moves)" and "On a result of 2, the player automatically assigns one critical hit to each leg that has not yet been destroyed"; "For each turn in which the system is not used, reduce the target number at which critical hits are assigned by one interval, but never below 3."
- Code: `activateMASC` sets the flag and returns true with no roll (roll deferred to `rollMASC`, which callers would run after movement); failure destroys one actuator in the first leg found and returns (`_applyMASCLegDamage`, lines 307-318) instead of one critical hit on *each* leg; `deactivateMASC` resets `mascTurnsActive` to 0, losing the one-interval decay. `activateMASC`/`rollMASC` have no caller in src or UI — MASC can never be activated in a real game.
- Pinned by: tests/rules/movement/MovementCalculator.test.js:570-613 ("destroys one leg actuator on failure", "destroys first OK actuator in left leg before right leg") and tests/integration/equipment.test.js:326-347 (asserts only ">0 damaged actuators").
- Fix: roll on activation before movement; on failure assign one crit to each surviving leg (with normal crit effects) and apply PSR consequences before moving; decay the failure target by one interval per idle turn.

#### M-20 · high · src/rules/movement/PSRCalculator.js:95-105, 116-155
- Manual (p54/p142; footnote 9): the main table has the cause rows "Gyro hit +3" and "Hip actuator destroyed +2"; the *Preexisting Damage / Special Cases* block instead reads "Gyro previously hit +3", "Per hip actuator previously destroyed +2" and "Leg previously destroyed +5" — "These cases do not cause PSRs, but their modifiers apply to all PSRs made." p48: "A damaged gyro forces a PSR every time the 'Mech runs or jumps"; the hip requires a PSR only when running/jumping and in the phase the crit occurred.
- Code: `getPSRTriggers` pushes "Gyro Damage", "Hip Actuator Damage" and "Missing Leg" as *triggers* for every move, so a walking 'Mech with a damaged gyro/hip or a missing leg is forced to roll a PSR on every hex of movement. The engine calls `getPSRTriggers` after each move (GameEngine.js:262-274), so these extra rolls happen in play.
- Pinned by: tests/rules/movement/PSRCalculator.test.js:63-93, 216-263 (asserts triggers in the no-movement case).
- Fix: separate persistent modifiers (applied by `calculatePSRModifier` to any PSR) from causes (only added when running/jumping or the phase of the critical hit).

#### M-21 · high · src/rules/movement/PSRCalculator.js:123-127
- Manual (p52 Shutdown): "If a 'Mech shuts down involuntarily, a Piloting Skill Roll (see p. 53) is immediately required, with a +3 Target Number modifier. Regardless of how it shut down, any other PSR required while shutdown fails automatically."
- Code: `if (unit.shutdown) { … return targetNumber: 999 }` inside `calculatePSRModifier` — this also auto-fails the involuntary-shutdown PSR itself, which PhaseManager.js:252-257 raises with `{ trigger: 'Involuntary shutdown', baseModifier: 3 }`. The 'Mech can never fall from the shutdown itself; it just silently fails.
- Pinned by: none (no shutdown test in PSRCalculator tests).
- Fix: only auto-fail when the trigger is not the involuntary-shutdown trigger (pass a flag/trigger id), so the shutdown PSR resolves at piloting+3.

#### M-22 · high · src/rules/movement/PSRCalculator.js:184-203
- Manual (p58 Damaging a MechWarrior—Falling): "If a 'Mech falls, its controller must immediately make a Piloting Skill Roll for the MechWarrior, before applying any falling damage to the 'Mech. All modifiers applied to the PSR that caused the fall are applied to this second roll, with an additional +1 modifier applied to the Target Number for every level above 1 fallen as well. If the roll fails, the warrior takes 1 point of damage."
- Code: `resolveFall` unconditionally does `unit.pilot.hits++` and returns `pilotHit: true`; it never rolls a PSR, ignores `diceRoller`/`fallDirection`, and skips consciousness rolls.
- Pinned by: tests/rules/movement/PSRCalculator.test.js:608-634 ("sets unit prone and applies pilot hit").
- Fix: make the MechWarrior PSR (with the fall's modifiers +1/level above 1) and only add the hit on failure; go through the consciousness-roll path.

---

### Medium
#### M-23 · medium · src/rules/movement/PSRCalculator.js:19-25
- Manual (p60 Terrain Types): "WOODS, LIGHT … PSR Modifier: No PSR"; "WOODS, HEAVY … PSR Modifier: No PSR"; "JUNGLE, LIGHT … PSR Modifier: +1"; "JUNGLE, HEAVY … PSR Modifier: +2". p142: "Entered light jungle hex +1", "Entered heavy jungle hex +2".
- Code: `enteredLightWoods` → +1 and `enteredHeavyWoods` → +2, with comments citing "p54: entering light jungle/woods +1". The jungle values are applied to woods; jungle is not modelled at all.
- Pinned by: tests/rules/movement/PSRCalculator.test.js:357-374 (comment "p54: entering heavy jungle/woods is +2"). Latent: GameEngine.js:262-268 currently hardcodes all these flags to false.
- Fix: split `enteredLightJungle/enteredHeavyJungle` (+1/+2) from woods (no PSR); update tests and comments.

#### M-24 · medium · src/rules/movement/PSRCalculator.js:55-60; src/rules/movement/TerrainRules.js:12-23
- Manual (p60): "SAND … PSR Modifier: +1"; "WATER (DEPTH 0) … PSR Modifier: No PSR".
- Code: no sand trigger or sand modifier anywhere; entering Depth 0 water (`waterDepth: 0`) pushes an "Entered Water" trigger with 0.
- Pinned by: tests/rules/movement/PSRCalculator.test.js:152-159 ("entered water depth 0 = +0 modifier").
- Fix: add sand (+1) as a terrain-entry trigger; do not trigger for Depth 0 water.

#### M-25 · medium · src/rules/movement/PSRCalculator.js:27-53, 81-93
- Manual (p54/p142): no "large level drop" PSR exists (a 2+ level drop is an accidental fall, p70/p56); "No PSR is required for a 'Mech to jump into a woods hex" (p132 misconception 3); there is no "rapid turn" PSR.
- Code: adds 0-modifier triggers "Large Level Drop", "Jumped Into Woods", "Rapid Turn (Running)" (manual does not define them), and the "20+ Damage Received" and "Physical Attack Received" triggers depend on `unit._damageThisPhase` / `unit._physicalAttackReceived`, which no code in src ever sets (grep: only PSRCalculator references them). The 20+ damage PSR therefore never fires anywhere; physical-attack PSRs are instead raised explicitly by GameEngine.js:712-745. Also, if `_physicalAttackReceived` is ever set to boolean `true`, a charge/DFA yields 0 instead of +2.
- Pinned by: tests/rules/movement/PSRCalculator.test.js:96-103 (boolean → 0), :377-424 (fabricated triggers).
- Fix: remove the fabricated triggers; make the 20+ damage trigger explicit at the damage-resolution call site (or keep the field and set it in the damage resolver); make the physical-attack kind required (charge/dfa → +2) or drop the dead path.

#### M-26 · medium · src/rules/movement/PSRCalculator.js:116-155
- Manual (p142 Special Cases): "Four-legged 'Mech with all legs –2"; "Unintentional charge +3"; "'Mech mounts AES in its legs –2"; "'Mech mounts Hardened Armor +1"; "'Mech mounts small or torso-mounted cockpit +1".
- Code: none of these are applied (`calculatePSRModifier` only adds trigger modifiers + `quirkPSRModifier`, which covers Cramped Cockpit/Hard to Pilot/Unbalanced only).
- Pinned by: none.
- Fix: apply the special-case modifier table in `calculatePSRModifier`.

#### M-27 · medium · src/rules/movement/PSRCalculator.js:99-105, 223-232
- Manual (p48 Hip): "PSR Modifiers: +2 per hip critical hit; this modifier overrides all other critical hit modifiers from that leg." p142 footnote 10: "Do not add modifiers for other damaged actuators in the leg."
- Code: hip is excluded from `_countActuatorHits`, but other destroyed actuators *in the same leg as the destroyed hip* still count, so that leg contributes +2 +N. Only two hips on different legs are separated.
- Pinned by: tests/rules/movement/PSRCalculator.test.js:306-320 (uses hip on left and actuator on right — does not cover the same-leg case).
- Fix: when a leg's hip is destroyed, ignore that leg's upper/lower/foot actuator hits.

#### M-28 · medium · src/rules/movement/PSRCalculator.js:192-198
- Manual (p56 Facing After a Fall): "roll 1D6 and consult the Facing After Fall Table … This facing change determines the Hit Location Table used when assigning damage from the fall"; "A fallen 'Mech is always prone and face down." p74 example: "20 tons divided by 10, multiplied by the number of levels fallen +1 (2 levels +1 = 3)."
- Code: `fallDamage = baseDamage * levelsFallen` (missing the +1 for level falls), `locations: ['leftLeg','rightLeg']` is a hardcoded stub instead of the Facing After Fall roll, and the returned damage is discarded by the only caller (GameEngine.js:285-287 applies only `unit.prone = true`).
- Pinned by: tests/rules/movement/PSRCalculator.test.js:636-713 (asserts ×levelsFallen and the stub result shape).
- Fix: roll Facing After Fall, use `ceil(tonnage/10) × (levelsFallen + 1)` for level falls (1× for 0-level falls), return the hit-location column and 5-point groupings, and apply them at the caller.

#### M-29 · medium · [consolidated → BLD-01] · src/data/terrain.json:131-136 (consumed by src/rules/urban/Buildings.js:33-36 → GameEngine.js:987-989)
- Manual (p142 Building Movement): "'Mech entering light building hex 0; medium building hex +1; heavy building hex +2; hardened building hex +5."
- Code: `hardened.psrModifier: 3` (light 0, medium 1, heavy 2 are correct). Building-entry PSRs therefore use +3 instead of +5 for hardened buildings.
- Pinned by: none.
- Fix: set hardened to 5; add a test against the p142 table.

#### M-30 · medium · src/rules/movement/MovementCalculator.js:16-27, 42
- Manual (p17/p136): "Light jungle +2", "Heavy jungle +3", "Sand +0 +1" (PSR); p60 confirms.
- Code: no jungle or sand terrain types; unknown terrain defaults to 1 MP, so light jungle costs 1 (manual 3), heavy jungle 1 (manual 4), sand 1 (correct by accident). terrain.json has no jungle/sand entries either (latent — no shipped map uses them).
- Pinned by: tests/rules/movement/MovementCalculator.test.js:150-154 ("unknown terrain defaults to 1 MP").
- Fix: add light_jungle (base+2), heavy_jungle (base+3), sand (base+0, PSR +1).

#### M-31 · medium · src/rules/movement/MovementCalculator.js:24; src/rules/movement/TerrainRules.js:18-22
- Manual (p17/p136): "Swamp +1 +1§" under *Terrain Modifications*; p61 has a "Swamp (Simplified)" section (body missing).
- Code: swamp is a terrain type with absolute cost 3 (should be underlying terrain +1, i.e. 2 over clear), and `hex.modifiers.swamp` (supported by Hex.js:20) is ignored because TerrainRules only checks `terrainType === 'swamp'`.
- Pinned by: tests/rules/movement/MovementCalculator.test.js:132-136 ("swamp costs 3 MP"); tests/rules/movement/TerrainRules.test.js:18-20.
- Fix: treat swamp as a modification (+1 MP, PSR +1) on any underlying terrain, reading the flag or the terrain type.

#### M-32 · medium · src/rules/movement/MovementCalculator.js:113-190, 160, 234
- Manual (p16 Minimum Movement): "A 'Mech can move into the hex directly in front of it, even if it does not have the MP normally required … It has at least 1 MP to spend … Such movement is the only MP it expends that turn"; p17/p136 Additional Movement Actions: "Dropping to the ground 1", "Standing up 2/attempt +0", "Lateral Shift (quad 'Mechs only) +1".
- Code: `getValidMoves` discards any move whose cost exceeds maxMP (`if (newCost > maxMP) continue`) and there is no minimum-movement fallback; drop-to-ground, stand-up and lateral-shift costs do not exist anywhere in the movement module.
- Pinned by: tests/rules/movement/MovementCalculator.test.js:789-796 (over-budget hex excluded).
- Fix: implement minimum movement as a special legal move (1 MP, straight ahead, run mode, no other MP spent); add the additional-action costs.

#### M-33 · medium · src/rules/movement/MovementCalculator.js:151
- Manual (p16 Occupied Hexes): "A 'Mech can move through a hex occupied by a friendly 'Mech, but cannot enter a hex occupied by an enemy 'Mech"; stacking blocks only *ending* in an occupied hex.
- Code: `if (neighborHex.occupiedBy && neighborKey !== startKey) continue;` blocks all occupied hexes (friend or foe) for all movement types, so a friendly 'Mech can never be passed through.
- Pinned by: tests/rules/movement/MovementCalculator.test.js:798-822 ("respects occupied hexes", "can move through occupied hexes from starting position" — the latter actually asserts blocked with `occupiedBy: 'self'`).
- Fix: block enemy-occupied hexes for entry and any occupied hex as a final hex; allow transit through friendly hexes.

#### M-34 · medium · src/rules/movement/MovementCalculator.js:163, 113-190
- Manual (p14 Facing): "Changing facing costs 1 MP per hexside"; p70 skid diagram: "will spend the Griffin's remaining 1 MP to turn to Hexside 6, in preparation for moving …".
- Code: `getValidMoves` only returns facing values produced by entering a hex, and `validateMovement` sets `finalFacing` to the last movement direction; there is no way to spend MP turning in place at the end of a move (or before moving), and `calculateFacingChange` has no caller.
- Pinned by: none.
- Fix: add facing-only states to the move graph (cost 1 MP/hexside) and let a path end with a purchased facing change.

#### M-35 · medium · src/rules/movement/PSRCalculator.js:161-162
- Manual: PSRs are raised with the movement context (p54/p68); the API should accept it.
- Code: `makePSR(unit, diceRoller, triggers = null)` has no `movement` parameter, and falls back to `getPSRTriggers(unit, null, null)` — so movement-based triggers are never derived by `makePSR`. tests/rules/movement/PSRCalculator.test.js:598-605 calls `calc.makePSR(unit, dr, null, movement)` with a 4th argument that JS silently drops and then asserts `targetNumber` 5: the test is vacuous and hides the missing wiring.
- Pinned by: that test.
- Fix: add a `movement` parameter (or require callers to pass triggers) and rewrite the test to assert a movement-derived trigger reaches the roll.

#### M-36 · medium · src/rules/movement/TerrainRules.js:60-63; src/rules/movement/MovementCalculator.js:59-65
- Manual (p20 Reckless Movement): "Applies to: Ice, Mud, Deep Snow, Swamp, Fog, Full-Moon Night, Moonless Night … players who do not want to pay this MP cost can instead announce their intention to move recklessly … the 'Mech's controller must make a Piloting Skill Roll. Success means that the 'Mech enters the hex as normal. If the roll fails, the 'Mech immediately falls in the hex just entered."
- Code: the +1 MP is always charged and a terrain PSR is always raised for the destination hex by the engine (GameEngine.js:269); Reckless Movement (declining the MP for a roll) is not implemented anywhere. `requiresTerrainPSR` is exported but unused. p61 body is missing, so whether the standard (non-reckless) entry also requires a roll cannot be confirmed — but the reckless alternative is definitely absent.
- Pinned by: none (no reckless-movement test).
- Fix: add a per-move "reckless" declaration; when reckless, skip the modifier MP and roll the terrain PSR (fall on failure).

---

### Low
#### M-37 · low · src/data/terrain.json:79-99
- Manual (p17/p136): ice/mud/deep snow/swamp are +1 MP each.
- Code: `modifiers.ice.mpCostMultiplier: 1.5`, `mud/deep_snow.mpCostMultiplier: 2` — unused by MovementCalculator (which hardcodes +1) and inconsistent with the table. Duplicate sources of truth for costs (MovementCalculator constants vs terrain.json vs Hex.getMPCost) invite drift.
- Pinned by: none.
- Fix: single additive `mpCost` field per terrain/modifier, consumed by MovementCalculator.

#### M-38 · low · src/hex/HexMath.js:109-115, 212-231
- Manual: no numbered facing convention (implementation-defined); adjacency itself is correct (flat-top even-q, current facing 0=N clockwise).
- Code: `offsets[direction % 6]` throws for a negative direction (JS `-1 % 6 === -1`), and `directionBetween` returns a "nearest" direction for non-adjacent hexes (used only pairwise, so harmless today). Unused imports in MovementCalculator (hexToPixel, hexDistance, hexKey, parseHexKey) and in SkiddingRules (adjustFacing).
- Pinned by: tests/hex/HexMath.test.js:102-116.
- Fix: normalise with `((direction % 6) + 6) % 6`; assert adjacency in `directionBetween`; drop unused imports.

---

**Confirmed correct by the audit (no action):** terrain entry costs for clear/woods/rough/rubble/pavement/bridge and all building surcharges (p17/p136); ice/mud/deep-snow +1 MP and PSR +3/+1/+1 (p17/p136/p142); uphill +1/+2, jump 1 MP per hex ignoring terrain and the 3-level climb cap (p17/p18/p128); PSR base and the confirmed modifier values (gyro +3, hip +2, missing leg +5, 20+ damage +1, water depth −1/0/+1, heavy rain/torrential +1/+2); physical-attack PSRs (+2 charge/DFA target, +2 attacker charge, +4 attacker DFA) in `GameEngine.js:712-745`; building-entry PSR and CF damage apart from the hardened value; the HexMath facing/adjacency conventions; and the shorter-turn facing cost (`min(diff, 6 - diff)`), which matches p14 and p143 (M-04 is withdrawn, not a defect).

## 3.2 Weapon attack, LOS, arcs and damage (t2)

**Audited:** `src/rules/combat/{AttackResolver,LineOfSight,ArcRules,UnitDamage,DamageResolver}.js`, `src/data/hitTables.json`, `src/data/weapons.json`.
**Counts:** 2 blockers, 6 high, 9 medium, 10 low (C-05 downgraded to low/latent in review R-02).
**Consolidation:** C-01 = D-03 (t6) = X-01 (t3); the data-file fix is also described in §3.6. C-04 overlaps M-25 (t1) but is the canonical high-severity entry for the dead 20+ damage PSR.
**KB pages used:** p24, p26, p28–p30, p32, p42, p44, p46, p48, p52, p54, p58, p60, p64, p96, p118, p131, p139–p143 (p31/p47/p49/p51 are absent; see Appendix A).

#### C-01 BLOCKER — Left/right side hit-location columns are the front table (and its mirror)
- File: src/data/hitTables.json:39-74 ("left"), :75-110 ("right"); called through AttackResolver.js:357-360 (table lookup :403-415).
- Manual p139 'MECH HIT LOCATION TABLE: "Roll 2* Left Torso [critical] Center Torso [critical] Right Torso [critical]; 3 Left Leg … Right Arm … Right Leg; 4 Left Arm … Right Arm … Right Arm; 5 Left Arm … Right Leg … Right Arm; 6 Left Leg … Right Torso … Right Leg; 7 Left Torso Center Torso Right Torso; 8 Center Torso Left Torso Center Torso; 9 Right Torso Left Leg … Left Torso; 10 Right Arm … Left Arm … Left Arm; 11 Right Leg … Left Arm … Left Leg; 12 Head Head Head." (columns = Left Side | Front/Rear | Right Side)
- Code: `left` is the front column verbatim (2 CT crit, 3-4 rightArm, 5 rightLeg, 6 rightTorso, 8 leftTorso, 9 leftLeg, 10-11 leftArm); `right` is its mirror (3-4 leftArm, 5 leftLeg, 6 leftTorso, 8 rightTorso, 9 rightLeg, 10-11 rightArm). A left-side attack hits the left torso only on roll 8 (5/36); the manual also puts LT on rolls 2 and 7, for 7/36. Roll 2 never crits the near-side torso. Correct distribution for the Left Side column: LT 7/36, LA 7/36, LL 7/36, CT 5/36, RT 4/36, RA 3/36, RL 2/36, Head 1/36.
- Pinning test: tests/rules/combat/HitTables.test.js:74-108 ('weights right-side locations on low rolls (3-6)' asserts rightArm/rightArm/rightLeg/rightTorso on the LEFT table), :110-144, :146-163 ('left side attack maps roll 3 to rightArm'). File is titled "HitTable BMM compliance" but never cites p139.
- Fix: replace both columns with the p139 values; roll 2 = Left/Right Torso with critical.

#### C-02 BLOCKER — Rear attacks use an invented rear table; isRear on arm/leg entries bypasses all armour
- File: src/data/hitTables.json:111-156 ("rear"); DamageResolver.js:44-55 reads `armorLoc.rear || 0`.
- Manual p139: the table has exactly three columns and the middle one is labelled "Front/Rear". p44 TRANSFERRING DAMAGE: "Damage dealt to the rear hit zone (see p. 32) that transfers inward transfers to the appropriate rear torso facing." p42 flow: "If transferring to a torso location, the damage is applied to the front armor unless the attack came from the rear."
- Code: a separate invented table (3 leftArm, 4 leftTorso, 5 leftLeg, 6 centerTorso, 8 rightTorso, 9 rightLeg, 10/11 rightArm) that is not a copy of the front column — it differs at roll 4 (leftTorso vs leftArm) and roll 6 (centerTorso vs leftTorso) — with isRear:true on every entry except head. Arms/legs carry rear:0 (mechs.json atlas: leftArm {front:34,rear:0}), so `armorLoc.rear` = 0 and the whole hit goes to internal structure: rolls 3, 5, 9, 10 and 11 = 15/36 of rear hits skip 34-41 points of limb armour.
- Pinning test: none. AttackResolver.test.js:761-765 only checks roll 7 (centerTorso + isRear). The armour bypass is untested.
- Fix: delete the 'rear' table; for 'rear' use the front column and set isRear only for centerTorso/leftTorso/rightTorso. Also fix BattlefieldSupport.js:282, which consumes hitLocation.rear.

#### C-03 HIGH — Cluster damage is not split into Damage Value groupings (LRM/MRM/ATM)
- File: src/rules/combat/AttackResolver.js:348-394 — one hit-location roll per missile, `damage: weaponDef.damage` (1 for LRMs).
- Manual p32: "Cluster Attacks: … Those that hit are broken up into a series of damage groupings, and then a separate hit location roll is made for each grouping (see C: Cluster, p. 96)." p96: "For all standard SRM launchers (C2), every 2 points of Damage Value dealt is a separate hit … For all ATM, LRM, and MRM launchers (regardless of the launcher size or damage per projectile), the grouping size is 5 (C5)."
- Code: an LRM-20 rolling 12 hits produces 12 separate 1-point hits instead of groupings of 5+5+2. Damage total is right, distribution is not: 12 independent head-hit chances (each then wounds the pilot via GameEngine.js:559-563), 12 critical rolls and 12 TAC chances instead of 3. Up to 12 pilot hits from one salvo instead of 3.
- Pinning test: AttackResolver.test.js:911-926 ('resolves cluster hits for missile weapons on hit', `hitLocations.length === 6` for SRM-6 — correct because C2, but the same path serves LRMs; no LRM assertion).
- Fix: build groupings by weapon class (SRM 2 / LRM-MRM-ATM 5) and roll one location per grouping.

#### C-04 HIGH — The 20+ damage PSR trigger is dead code
- File: src/rules/movement/PSRCalculator.js:81-84; `unit._damageThisPhase` has no writer anywhere in src (verified by grep).
- Manual p54/p142 PILOTING SKILL ROLL TABLE: "Damage to 'Mech — 'Mech takes 20+ damage points in one phase: +1"; p64/p131: "In the standard rules, the modifier is only ever +1, whether the damage taken in a phase was 20 points or 60". p32: "All Piloting Skill Rolls required due to weapon attacks are made at the end of the Weapon Attack Phase."
- Code: nothing accumulates per-phase damage (GameEngine.js:518-565 applies damage per attack), and PhaseManager never runs a weapon-phase PSR pass (only _enterHeatPhase:252-260 for shutdown and the movement handler). The trigger and `_physicalAttackReceived` (:86-93) are both unreachable.
- Pinning test: tests/rules/movement/PSRCalculator.test.js:122-146 sets `_damageThisPhase` directly in the fixture — the unit test passes while the engine never sets it.
- Fix: accumulate damage per unit per phase (weapon, physical, ammo, fall), run getPSRTriggers for every unit at the end of the Weapon Attack Phase, reset at phase entry.

#### C-05 LOW [DOWNGRADED; latent map defect] — destroyed side torso transfer map points at the arm, but the live path is masked
- File: src/rules/combat/DamageResolver.js:263-274 (`getTransferLocation` map: `leftTorso:'leftArm'`, `rightTorso:'rightArm'`, `head:'centerTorso'`), used at :85-97.
- Manual p44: "Damage to a missing arm or leg transfers to the torso on the same side … Additional damage to a destroyed side torso location transfers to the center torso. Damage from a destroyed head or center torso does not transfer."
- Code: the map entry is wrong, but it is masked in live damage resolution. Before transferring, `handleLocationDestruction(unit, 'leftTorso')` calls `destroyLocation(unit, 'leftArm')` (`DamageResolver.js:236-240`); the next guard, `unit.isLocationDestroyed('leftArm')` at `:89`, is then true, so `transferLocation` is rewritten to `'centerTorso'`. The right side behaves the same way with `rightArm`.
- Pinning test: `DamageResolver.test.js:209-215` asserts the outward map target; `DamageResolver.test.js:138-146` **passes** — the reviewer ran the fixture through the real resolver and got `transferLocation = centerTorso`, CT armour 31→20. The map remains a latent/robustness defect for any caller that reaches it without the arm-destroyed guard; the earlier claim that the suite must be red was wrong.
- Fix: change `leftTorso`/`rightTorso` → `centerTorso` and `head` → `null` as hardening; add a direct unit test on `getTransferLocation` so the map cannot regress.
- Status: **DOWNGRADED** high → low in review R-02 (latent map defect, not a live transfer bug).

#### C-06 HIGH — Critical hits: only ever one critical; no 2- or 3-crit results and no blown-off limb/head
- File: src/rules/combat/DamageResolver.js:105-121.
- Manual p46/p143 DETERMINING CRITICAL HITS TABLE: "2–7 No Critical Hit; 8–9 Roll 1 Critical Hit Location; 10–11 Roll 2 Critical Hit Locations; 12 Head or Limb Blown Off / Roll 3 Critical Hit Locations (Roll 3 critical hit locations if the hit struck a torso location)." p48: "LEG BLOWN OFF (LEG) This critical hit occurs when the player rolls a 12 on the Determining Critical Hits Table for a leg location hit, and is automatic", "HEAD BLOWN OFF (HEAD) A hit blows off a 'Mech's head when the player rolls a 12…". The arm-specific "ARM BLOWN OFF (ARM)" text appears only as a table-of-contents/index heading (the p47 body is absent), so the arm consequence remains unverified.
- Code: 2D6 < 8 = nothing, otherwise exactly one slot destroyed; a 10, 11 or 12 is indistinguishable from an 8.
- Pinning test: DamageResolver.test.js:165-190 only asserts `criticalHits.length > 0` / engine.hits > 0.
- Fix: implement the four result bands, 3 crits on a torso 12, and the limb/head blown-off result.

#### C-07 HIGH — Critical-hit slot selection ignores the 1-3/4-6 block structure and multi-slot items
- File: src/rules/combat/DamageResolver.js:113-118 (`validSlots[Math.floor(diceRoller.next()*validSlots.length)]`), plus :146-149 counting one heat sink per slot.
- Manual p46: "Torso or Arm Hits: The Critical Hit Table for these locations is divided into two blocks of six slots … first rolls 1D6 … 1–3 first block, 4–6 second block. The attacker then rolls another 1D6 … If the slot rolled is an inapplicable slot, roll both dice again." p46: "Multi-slot Components: … A single critical hit disables any item or structural component except the engine, gyro, or sensors, regardless of its number of slots. Critical hits on additional slots occupied by the item have no further effect, but soak up the hit." p46 Inapplicable Slots: "the slot has already taken a critical hit / the slot is empty / the slot cannot take critical damage (such as endo-steel, CASE, TSM, or ferro-fibrous armor slots)".
- Code: uniform pick over occupied slots — biased away from multi-slot items, no inapplicable-slot re-roll, and a 3-slot double heat sink is scored as three destroyed sinks.
- Pinning test: DamageResolver.test.js:182-189 uses `next() { return 0.5; }` (a code constant, not a dice sequence).
- Fix: block+D6 selection over the real 12-slot layout; destroy the item once and soak its remaining slots.

#### C-08 HIGH — Through-armour critical (hit location 2) never happens
- File: src/data/hitTables.json:4-7 (front "2" carries `critical: true`); AttackResolver.js:386-393 builds hitLocations without it; no consumer reads `.critical`.
- Manual p32: "Critical Hit: A roll of 2 when determining hit location creates the chance for a critical hit in the torso location rolled, even if the armor remains intact in that location (see Through-Armor Critical Hit, p. 45)." p139 footnote: "A result of 2 may inflict a critical hit. Apply damage to the armor in that section in the normal manner, but the attacking player also rolls once on the Determining Critical Hits Table, p. 46."
- Pinning test: AttackResolver.test.js:747-751 asserts the table flag only; nothing asserts the roll happens.
- Fix: propagate `critical` into hitLocations and roll once on the Determining Critical Hits Table when it is set (armour untouched).

#### C-09 HIGH — Weapon fire is never validated against mounted/destroyed weapons, per-weapon-per-turn fire, or ammunition
- File: src/engine/GameEngine.js:412-469 — `const weaponDef = action.weapon` (caller-supplied), no check that the weapon is still mounted or its location intact; `firedThisTurn` is written (:509-512) but never read; ammo is consumed only `if (weaponDef.usesAmmo() && action.ammoBin)` (:464-469), so an ammo weapon with no bin fires free.
- Manual p24 ATTACK DECLARATION: "Each weapon can make one attack a turn (though some weapons can fire multiple shots per attack)." p31 AMMUNITION EXPENDITURE is index/TOC-only in the KB, so the expenditure wording is unverified; p48 covers critical-hit/weapon-loss effects and p96 covers ammunition-bin damage.
- Consequence: the same weapon can fire repeatedly in one phase (heat only), and a weapon in a blown-off arm can keep firing.
- Pinning test: none (all combat tests fire once per action).
- Fix: resolve the weapon from the unit's own loadout, reject destroyed locations/weapons, enforce one attack per weapon per turn, and require/consume an ammo bin.

#### C-10 MEDIUM — Partial cover from a building must damage the building; the hit is discarded instead
- File: src/rules/combat/AttackResolver.js:374-393 (absorbedByCover -> damage 0); GameEngine.js:524-529 skips the hit.
- Manual p26: "if the hit location roll indicates a leg, the attack strikes the cover instead. In that event, if the partial cover is a building, the hit damages the building; otherwise, the attack does not deal damage." p32: "If the partial cover is a building, the hit damages the building."
- Pinning test: LineOfSight.test.js:269-284 (damage 0 + coverHex; no building case).
- Fix: when partialCoverKind === 'building', apply the weapon damage to that hex's CF (queued to end of phase, as the urban path at GameEngine.js:531-551 does) and nothing to the 'Mech.

#### C-11 MEDIUM — Aimed shots keep the +1 partial-cover modifier and can strike legs
- File: src/rules/combat/AttackResolver.js:210-214 (cover modifier always added), :362-384.
- Manual p30: "Partial Cover: If a target has partial cover, you can only aim for locations that are not behind cover. Do not apply the Target Number modifier for partial cover, and if a leg location is rolled when assigning a hit, re-roll until a non-leg hit location is rolled."
- Pinning test: IndirectFire.test.js:147-203 and LineOfSight.test.js:302-309 have no aimed+cover case.
- Fix: suppress the cover modifier and re-roll leg locations when options.aimedLocation is set.

#### C-12 MEDIUM — Aimed head shots must drop the -4 immobile modifier and add +3
- File: src/rules/combat/AttackResolver.js:83-86 (-4 unconditionally), :277-302 (no +3 head path).
- Manual p30: "Head Shots: If aiming at a 'Mech's head, the immobile target modifier is not applied, and an additional +3 modifier is added."
- Pinning test: IndirectFire.test.js:151-163 asserts only the resulting location, never the TN.
- Fix: in calculateTargetNumber, skip the immobile -4 and add +3 when aimedLocation === 'head'. (Also missing: aimed shots against mobile targets via a targeting computer, p30/p114.)

#### C-13 MEDIUM — Head-hit pilot damage is applied on the weapon path only
- File: src/engine/GameEngine.js:559-563 (weapon loop) vs :668-673 (physical loop calls damageResolver.applyDamage directly).
- Manual p58: "Head Hits: The MechWarrior takes 1 point of damage whenever the 'Mech's head takes a hit dealing 1 or more points of damage, even if the hit does not penetrate the 'Mech's armor".
- Pinning test: Modifiers.test.js:299-317 (weapon path only); PhysicalCombat.test.js has no head-hit pilot assertion.
- Fix: move the rule into DamageResolver.applyDamage (or a shared helper) so punches/kicks/DFA, mines and falls all trigger it.

#### C-14 MEDIUM — CASE: armour wiped and arm destroyed; the rule damages internal structure only and ignores the excess
- File: src/rules/combat/DamageResolver.js:193-199 (`if (hasCase) { this.destroyLocation(unit, location); return true; }`) and destroyLocation :248-258 (front/rear armour and IS both zeroed, then the arm is zeroed via handleLocationDestruction).
- Manual p118 CASE: "If ammo (or any other explosive component, such as a Gauss rifle) in a CASE-equipped location explodes, resolve the resulting damage to the internal structure in that location as normal. However, any excess damage is ignored, rather than transferring to an additional internal structure location. Remember that the loss of all internal structure in a side torso location also blows off the corresponding arm, though the arm is not damaged by the explosion and can still be used as a club."
- Pinning test: tests/integration/equipment.test.js:33-51 ('…destroying the location but leaving armor on associated arm' asserts getArmor('leftTorso') === 0 and isLocationDestroyed('leftArm') === true) and :118-138.
- Fix: apply the explosion to that location's internal structure only; destroy the location if IS reaches 0; leave armour and the arm's own armour/structure alone; only transfer when no CASE (see C-15). CASE II is not modelled at all (its p119 rule text is absent from the KB; unverified).

#### C-15 MEDIUM — Ammo-explosion damage never transfers inward
- File: src/rules/combat/DamageResolver.js:200-207 (`internalStructure[loc] = Math.max(0, IS - explosionDamage)`).
- Manual p44: "Ammunition Explosion: Damage from ammunition explosions transfers to the internal structure of the next location inward, bypassing the armor entirely."
- Pinning test: tests/integration/equipment.test.js:70-84 ('ammo explosion without CASE destroys location when damage exceeds IS' asserts CT internal unchanged).
- Fix: compute the excess and recurse into the transfer location's internal structure (bypassing armour), applying CASE at each step.

#### C-16 MEDIUM — A critical that destroys the location should resolve only explosive-component crits
- File: src/rules/combat/DamageResolver.js:66-81 (crit resolved before the destruction test, full effects applied).
- Manual p42/p141 flow chart: "The location is destroyed. Immediately roll once on the Determining Critical Hits Table… Only critical hits that strike explosive components are resolved; all others are discarded."
- Pinning test: none (DamageResolver.test.js fixtures use a roller that never crits).
- Fix: when internal damage destroys the location, keep only explosive results.

#### C-17 MEDIUM — Engine/gyro/cockpit critical consequences are not applied
- File: src/rules/combat/DamageResolver.js:128-139.
- Manual p48 GYRO: "The first hit to a gyro damages it, and the second destroys it. When a 'Mech's gyro is destroyed, the 'Mech automatically falls. 'Mechs with a destroyed gyro are always prone." (Engine/cockpit p47 blocks are not retrievable from the KB — see cannot-verify.)
- Code: engine.hits>=3 only writes an effect string (unit.destroyed not set); gyro.hits>=2 only writes a string (prone not set, no fall); cockpit sets `pilot.conscious = false` but not `dead`/`unit.destroyed`.
- Pinning test: DamageResolver.test.js:182-189 (engine.hits > 0 only).
- Fix: apply the state changes alongside the message.

#### C-18 MEDIUM — Damage is applied during the phase, contrary to p32 damage timing
- File: src/engine/GameEngine.js:494-566 (applyDamage inside the firing action).
- Manual p32: "Only after all weapon attacks have been made is the damage caused as a result of those attacks applied. As such, damage dealt in a Weapon Attack Phase never affects attacks made that same phase (the attacks are all made before the gameplay effects of damage caused as a result are applied)." p131 misconception 3 repeats it.
- Consequence: a weapon destroyed by an earlier attack this phase (C-09) can prevent a later declared attack; PSRs are evaluated at the wrong time (C-04).
- Pinning test: none.
- Fix: queue hit locations for the whole phase and resolve them after declaration, then run end-of-phase PSRs.

#### C-19 LOW — Sensor critical effect text says +1; the rule (and the code's own modifier) is +2
- File: src/rules/combat/DamageResolver.js:140-142 ('Sensors destroyed (+1 TN)') vs UnitDamage.js:34-38 / AttackResolver.js:111-114 (+2).
- Manual p28: "Sensor hit +2". Fix the string (it leaks into UI/logs).

#### C-20 LOW — "Pilot hits" as a weapon-attack modifier is not in the BMM attack tables (unverified, possibly invented)
- File: src/rules/combat/AttackResolver.js:150-154.
- p28/p29 ATTACK MODIFIERS TABLES (All Attacks + Weapon Attacks Only) contain no pilot-hit entry; p58 DAMAGING A MECHWARRIOR gives no weapon TN modifier.
- Pinning test: AttackResolver.test.js:370-379 ('O: pilot hits modifier is added to TN') and the GATOR case :660-696 assert +1/hit.
- Fix: cite the rule or drop it. (RULES_AUDIT_REFERENCE §3 lists it too — see the doc warning below.)

#### C-21 LOW — Shutdown is modelled as an extra -4 on top of immobile
- File: src/rules/combat/AttackResolver.js:83-92.
- Manual p52: "A shutdown 'Mech becomes immobile (see p. 18)"; p28 offers only "Immobile –4".
- Code: `-4` for `target.immobile` and another `-4` for `target.shutdown`. In practice HeatManager sets only `shutdown`, so no double count today — but the model has two flags for one state.
- Pinning test: AttackResolver.test.js:337-345, :700-707.
- Fix: derive immobile from shutdown (single modifier).

#### C-22 LOW — Depth-2 water blanket-blocks LOS; p60 says LOS is unaffected
- File: src/rules/combat/LineOfSight.js:80-91.
- Manual p60 WATER (DEPTH 2): "Line of Sight (LOS): No effect." The restriction is an attack restriction: p28 "Depth 2 Underwater 'Mechs cannot target units that are not underwater".
- Practical outcome matches, but submerge/attack rules (p64) and prisms (a submerged 'Mech vs. another submerged one) are lost. No test.

#### C-23 LOW — Leg-mounted weapons may not fire through the attacker's own partial-cover hex
- Manual p24: "Leg-Mounted Weapons: Leg-mounted weapons may not fire through a hex that provides the firing 'Mech with partial cover, unless the partial cover is provided by water (see Combat in Water, p. 27)."
- Not implemented anywhere (AttackResolver/ArcRules). No test.

#### C-24 LOW — Arm-flip eligibility is enforced only in GameEngine, and the split-location condition is missing
- Files: src/rules/combat/ArcRules.js:93-110 (no eligibility check); GameEngine.js:1097-1118.
- Manual p24: "A 'Mech whose record sheet does not show hand and lower arm actuators in both arms on its Critical Hit Table and that does not have any weapons split between torso and arm locations can flip its arms… A 'Mech cannot torso twist and reverse its arms in the same turn… Prone 'Mechs may not reverse their arms."
- Actuators/prone/twist are checked in the engine; the "no weapon split between torso and arm" test is absent, and ArcRules itself will happily flip anything if called directly.
- Pinning test: Modifiers.test.js:229-251.

#### C-25 LOW — resolveClusterHit's proportional fallback is dead but dangerous
- File: src/rules/combat/AttackResolver.js:437-447. All 13 p139 columns exist (2,3,4,5,6,7,9,10,12,15,20,30,40), so the fallback cannot run; for any size not in the table (8, 11, 13, …) it returns the full cluster size. Test HitTables.test.js:67-71 is misnamed (size 5 is a real column and the direct lookup answers it).

#### C-26 LOW — determineHitLocation silently defaults to centerTorso
- File: src/rules/combat/AttackResolver.js:403-409 — unknown direction or roll returns centerTorso with no flag, masking bad data. Pinned by AttackResolver.test.js:767-775.

#### C-27 LOW — hitTables.json carries an unused critical-hit table; the bogus rear table is used by Battlefield Support
- src/data/hitTables.json:395+ `criticalHitTable` is read by no src file (grep). Meanwhile BattlefieldSupport.js:282 uses `hitLocation[isRear ? 'rear' : 'front']`, so C-02's armour-bypassing rear table also applies to support damage. PhysicalAttackResolver.js:177 also indexes hitLocation by direction.

**Confirmed correct by the audit (no action):** heat TN thresholds 8/13/17/24 with +1…+4 and the target-movement ladder (p28/p52); minimum range and range brackets (p29); `weapons.json` stats for the modelled Inner Sphere weapons (p121–p122); the Cluster Hits table values (p139); the front and front/rear hit-location data (p139) — the separate `rear` table is C-02; partial-cover conditions (p26/p28); torso twist and rear-mounted/flipped-arm arcs (p24); indirect-fire and aimed-shot rules (p30); pilot damage 2 from an ammo explosion and death at 6 (p58); arc legality before heat/ammo (p24).

## 3.3 Physical attacks and urban combat (t3)

**Audited:** `src/rules/combat/PhysicalAttackResolver.js`, `src/rules/urban/Buildings.js`, `src/rules/urban/Basements.js`, `src/data/physicalWeapons.json`; call sites in `GameEngine.js`, `hitTables.json` and `terrain.json` read as evidence.
**Counts:** 0 blockers, 6 high, 14 medium, 9 low.
**Consolidation:** PHY-01 = D-04 (t6); BLD-01 = M-29 (t1); **X-01** is C-01 and is not repeated as a separate finding here (its cross-module text is summarised under C-01).
**KB present:** p28–29, p36, p38, p48, p54/p142, p66, p68, p70, p72–p74, p139–p140, p143. **Absent:** p34–p35, p37, p39–p40, p47, p49, p67, p71 (see §4.3 and Appendix A).

### High
#### PHY-01 — Punch/kick hit locations are fabricated 2D6 tables; BMM uses 1D6 tables with side columns
- Files: `PhysicalAttackResolver.js:264-268, 315-319, 362-363, 404-405, 517-527, 596-604`; `src/data/hitTables.json:157-226`.
- BMM p38: "Determine the damage location by rolling **1D6** and consulting the appropriate column of the Kick Location Table, based on whether the 'Mech is a biped or four-legged design."
- BMM p139: "'MECH PUNCH LOCATION TABLE — Roll(**1D6**) Left Side Front/Rear Right Side — 1 Left Torso Left Arm Right Torso … 6 Head"; kick table is also 1D6 (1–3 one leg, 4–6 the other, with first-column = left-side/front-rear/right-side variants).
- Code: every physical attack rolls **2D6** (`diceRoller.roll2d6()`) and looks up an invented 11-entry table (`punch`: 2=head, 3-4=rightArm, 5-6=rightTorso, 7=CT, 8-9=leftTorso, 10-11=leftArm, 12=head; `kick`: legs alternating 2-12). No left-side/front/rear/right-side columns exist for punch or kick, so direction-specific results are impossible. Affects punch, kick, charge, DFA, claws and option-table physical weapons.
- Pinned by: `tests/rules/combat/PhysicalAttackResolver.test.js:38-54` (punch) and `:56-89` (kick, charge) — they assert the JSON constants as if they were the manual tables.
- Fix: replace both tables with the p139 1D6 tables keyed by attack direction; `punchLocation/kickLocation` must take a 1D6 roll + direction column; keep the 2D6 standard table only for standard-table attacks.

#### PHY-02 — Different Levels table is inverted for kick and punch
- File: `PhysicalAttackResolver.js:186-205` (`_levelRestriction`), `:211-220` (`_tableFor`).
- BMM p140: "Standing 'Mech **1 level higher**: Charge, Club (Kick Table), DFA, Physical Weapon (Kick Table), **Punch (Kick Table)**" / "Standing 'Mech **1 level lower**: Charge, Club (Punch Table), DFA, **Kick (Punch Table)**, Physical Weapon (Punch Table)". Punch is *not* allowed at a lower target; kick is *not* allowed at a higher target.
- Code: kick is allowed at +1 (with Punch table) and rejected at −1 ("Cannot kick a target one level lower"); punch is allowed at −1 (with Punch table). Exactly backwards for both.
- Pinned by: `tests/rules/combat/PhysicalCombat.test.js:52-62` ("a kick one level up rolls on the punch table"; "a kick one level down is not allowed").
- Fix: kick legal only at diff ≤0 (forced Punch table at −1); punch legal only at diff ≥0 (forced Kick table at +1); reject the inverse with the p140 reason.

#### BLD-01 — Hardened building entry PSR is +5, code uses +3
- Files: `Buildings.js:33-36` + `src/data/terrain.json:131-136` (`hardened.psrModifier = 3`).
- BMM p54/142 (Building Movement): "'Mech entering light building hex 0; medium +1; heavy +2; **hardened +5**". Same value in the Building Modifiers Table, p143: "Hardened … Piloting Skill Modifier **+5**".
- Code: `entryPSRModifier('hardened')` returns 3, so a hardened-building entry is 2 easier than the manual.
- Pinned by: `tests/rules/urban/Buildings.test.js:44-47` and `:147-153` (assert 3).
- Fix: set `psrModifier: 5` for hardened in `terrain.json`; update the two tests to the manual value. Also correct `docs/RULES_ROADMAP.md:192-193`, which records "+3" as ✅.

#### BLD-02 — "Combat within buildings" ignores levels entirely (LOS, +1 per level, roof vs inside)
- File: `Buildings.js:68-91`.
- BMM p72: "Line of sight is blocked if **more than two building hexes and/or levels** intervene between the attacker and target hex. Apply an automatic +1 Target Number modifier if the target 'Mech is inside a building hex (i.e. not on a roof) **and another +1 for each intervening building hex and/or level**." Worked example (p72): BattleMaster at Level 0 in Hex A vs Wolverine at Level 4 in Hex A → "three building hex levels are between … line of sight is not valid".
- Code: counts only building **hexes** on the LOS line (`line.slice(1,-1)`); never counts levels. Same-hex attackers/targets give `intervening = 0`, so a Level 0 vs Level 3 shot inside one building hex gets only +1 and is not LOS-blocked. `targetInside` is true for any unit in a building hex, including a roof.
- Pinned by: `tests/rules/urban/Buildings.test.js:177-211` (hex-only cases), `tests/integration/urban.test.js:214-227` (+1 target inside); no level case exists.
- Fix: pass attacker/target building level into `buildingCombat`, count intervening levels + hexes, block at >2, and add the +1 per intervening level (cap +3 applies to the intervening part only). Roof must not count as "inside".

#### BLD-03 — Building damage reduction uses live CF instead of the CF at the start of the phase
- Files: `Buildings.js:44-49` (reads `currentCF`), `GameEngine.js:531-547` (subtracts CF immediately).
- BMM p72: "A building reduces the damage of each hit on a 'Mech inside it by its current CF / 10 (round up; treat each Damage Value grouping as a separate hit). … Resolve damage to the building's CF at the end of the Weapon Attack Phase." Worked example: five attacks all use "38 ÷10 = 3.8, rounded up to 4" and "the building hex's CF is reduced from 38 to 19 … **at the end of** the Weapon Attack Phase".
- Code: each hit recalculates `ceil(currentCF/10)` from the already-reduced CF and subtracts immediately, so later hits in the same phase get less protection than the manual (diverges whenever CF crosses a multiple of 10).
- Pinned by: `tests/integration/urban.test.js:229-242` (single hit only: 40→36); no multi-hit-phase test.
- Fix: compute reduction from the start-of-phase CF (already captured as `hex._cfAtPhaseStart`), and bank CF damage until the end of the Weapon Attack Phase.

#### BAS-01 — Basement fall ignores the p66 weight condition; light 'Mechs fall whenever a basement exists
- Files: `Basements.js:23-41` + `GameEngine.js:1004-1024`.
- BMM p66: "A 'Mech **automatically falls through the floor into a basement if it is on Level 0 and its tonnage is greater than the building hex's CF** at the start of the current Movement Phase." The Basements Table's "The 'Mech falls 1/2 levels" gives the fall depth; "Small basement. No effect on 'Mechs" / "No basement" mean no fall.
- Code: `if (overweight || hex.basement.depth > 0)` — any basement result drops the 'Mech, regardless of weight (e.g. 20-ton Locust into a CF 90 hex).
- Pinned by: `tests/integration/urban.test.js:141-161` (Locust, CF 90, rolls double basement and is dropped) and `:163-182`.
- Fix: gate the fall on `(unit.tonnage > cfAtPhaseStart)`; the roll only determines whether a basement (and its depth) exists. Record the basement for later collapse/LOS use even when no fall occurs.

### Medium
#### PHY-03 — Arm-actuator damage halves physical-weapon damage; manual halves only punches
- File: `PhysicalAttackResolver.js:125-130, 515`.
- BMM p29/138: "Upper or lower arm actuator hit (each): **+2 to punching and physical weapon attack with arm; half damage for punching attack with arm**"; p48 lower arm: "Damage from punches with this arm is halved" + "+2 to any punches or physical weapon attacks with that arm"; p38 footnote "†Not reduced by absent or missing actuators" (flail).
- Code: `multiplier *= 0.5` for upper/lower arm in `physicalWeaponModifiers`, applied to hatchets/swords/flails etc. A hatchet doing 10 becomes 5 with one actuator hit — only the +2 is legal.
- Pinned by: none (`PhysicalAttackResolver.test.js:172-215` only tests punch/kick halving).
- Fix: physical weapon path adds +2 per arm actuator but keeps full damage (fixed 9 for flail).

#### PHY-04 — Kick ignores the fired-leg restriction
- File: `PhysicalAttackResolver.js:138-158` (`kickModifiers`); contrast `:69-75` (`_firedFrom`).
- BMM p38: "A 'Mech cannot kick with a leg if it fired weapons mounted in that leg that turn."
- Code: no `firedThisTurn` check for legs; only arms check it.
- Pinned by: none.
- Fix: reject the kick if either leg fired (or the leg used, if the API is extended to choose a leg).

#### PHY-05 — A punch in the left/right arc may be thrown with the wrong arm
- File: `PhysicalAttackResolver.js:242-252`.
- BMM p38: "if a target is in the right or left arc, only the right or left arm, respectively, may punch that target."
- Code: rejects only the rear arc; then uses `options.arm` verbatim, so `{arm:'rightArm'}` against a target in the left arc is accepted.
- Pinned by: none (`PhysicalCombat.test.js:195-207` uses forward-arc targets only).
- Fix: after choosing the arm, require `arc===LEFT ⇒ leftArm`, `arc===RIGHT ⇒ rightArm`.

#### PHY-06 — Club attacks are not implemented at all
- File: `PhysicalAttackResolver.js:25-32` (`BASE_MODIFIER.club` exists but is dead); no `resolveClub`/`clubModifiers`.
- BMM p36: "Base Target Number: Piloting Skill –1… target must be in the attacker's forward firing arc… cannot have fired any arm-mounted weapons… both shoulder actuators undamaged; two undamaged hand actuators… 1 point of damage for every 5 tons… Roll normally on the Hit Location Table. Claws: +2. Missing Actuators: +2 per damaged upper/lower arm actuator."
- Code: club is neither legal-checked nor resolved; girder/tree/limb club rules absent.
- Pinned by: none; `docs/RULES_ROADMAP.md:156` lists "clubs found on the battlefield" as still open.
- Fix: add `resolveClub` with the p36 legality set, damage `ceil(tonnage/5)`, standard table, and the Different-Levels forced table (Kick at +1 / Punch at −1).

#### PHY-07 — Physical weapon table is incomplete (Talons, Vibroblade)
- File: `src/data/physicalWeapons.json:4-12`.
- BMM p38 table lists nine entries: Claws, Flail, Hatchet, Lance, Mace, Retractable Blade, Sword, **Talons (0, ×1.5, "As per attack", kicks only)**, **Vibroblade (activated −2 / deactivated −2, (1 per 10 tons)+1)**.
- Code/JSON: seven entries; Talons and both Vibroblade modes are unresolvable ("Unknown physical weapon").
- Pinned by: `tests/rules/combat/PhysicalCombat.test.js:124-129` asserts the 7-id list as if complete.
- Fix: add the two entries (and a Talons damage mode of ×1.5 on kick damage), update the test to the 9-row table.

#### PHY-08 — Push: no PSR, no displacement, no shoulder modifier
- Files: `PhysicalAttackResolver.js:427-454`; `GameEngine.js:712-745` (`_resolvePhysicalConsequences` has no push branch).
- BMM p54/142: "**'Mech was pushed 0**" (PSR). BMM p130 misconception 15: "at the end of a successful push attack, the pusher moves into the enemy's hex." BMM p29/138: "Shoulder hit … **+2 to pushing attack (each)**."
- Code: `resolvePush` returns `targetPsrRequired` but the engine ignores it; no displacement/advance; TN ignores destroyed shoulders.
- Pinned by: `PhysicalCombat.test.js:261-285` covers charge/DFA/kick PSRs only; `PhysicalAttackResolver.test.js:316-330` covers adjacency/front only.
- Fix: add the pushed-target PSR at 0, displace the target and move the pusher into its hex, and add +2 per destroyed shoulder to the push TN.

#### PHY-09 — DFA is resolved in the Physical Attack Phase; no Jumping MP / height check
- File: `PhysicalAttackResolver.js:383-422`; `GameEngine.js:625-664` only exposes `attackType:'dfa'` in the physical phase.
- BMM p36: "Death from above (DFA) attacks are **declared in the Movement Phase**, not the Physical Attack Phase… The attacker spends the usual Jumping MP needed to reach the target's hex, but must have enough MP available to clear any height requirement (the level of the hex the target is in, plus two if the target 'Mech is standing)." Also "A 'Mech making a DFA cannot be the target of physical attacks".
- Code: DFA is a physical-phase action; only checks `movement.jump > 0`; no MP cost, no height clearance, no immunity.
- Pinned by: `tests/rules/combat/PhysicalCombat.test.js:275-285` (drives DFA entirely in `physical_attack`).
- Fix: declare DFA in movement (store pending DFA + MP check), resolve in the physical phase, and mark the attacker DFA-immune to physical attacks.

#### PHY-10 — Charge: distance unvalidated, self-damage never applied, no advance/displacement
- Files: `PhysicalAttackResolver.js:340-378` (returns `attackerDamage`), `GameEngine.js:668-681` (only applies attacker damage for `dfa`).
- BMM p36: "The JagerMech itself suffers 5 damage (45/10, rounded up)"; "If the charge succeeds and the attacker was not destroyed, the attacker then advances into the target's hex. If the target 'Mech is not destroyed, it is displaced into the adjacent hex…"; p130 misconception 12: "when determining damage, the hex the target occupies is not counted."
- Code: `distanceCharged` comes straight from the action (`|| 1`), never derived from the move or checked against MP; `attackerDamage` is computed then dropped; no advance/displacement/location-after-miss.
- Pinned by: `PhysicalAttackResolver.test.js:307-314` asserts the numbers only; `PhysicalCombat.test.js:261-273` asserts PSRs only.
- Fix: compute distance from the movement path (excluding the target hex), verify MP, apply the self-damage, and implement location-after-charge.

#### PHY-11 — All-attacks modifiers missing: prone target and terrain
- File: `PhysicalAttackResolver.js:550-594` (no `target.prone`, no terrain/state input).
- BMM p28: table header "All Attacks: Weapons and Physical"; "Target … **Prone –2 from adjacent hex; +1 from all others**"; "**Terrain** (modifiers are cumulative) Light Woods/Jungle +1 … Heavy +2 … Partial Cover +1". BMM p140 DFA note: "All the normal attack modifiers apply … but the roll is not modified for terrain" — i.e. terrain *does* apply to the other physical attacks.
- Code: a punch at an adjacent prone 'Mech gets no −2; a punch into woods gets no +1/+2; partial cover never applies. (The engine also never passes terrain state into the resolver.)
- Pinned by: none.
- Fix: add target-prone and terrain/partial-cover modifiers to `calculatePhysicalTN` (exclude DFA from terrain, per p36).

#### BLD-04 — Collapse damage: wrong "levels above", no 5-point groupings, wrong hit table for interior, missing extra falling damage
- Files: `Buildings.js:56-59` (helper is correct) + `GameEngine.js:1041-1058`.
- BMM p73: "If there are building levels above the 'Mech, add … the base damage multiplied by the number of building levels above that 'Mech… 'Mechs on the top level or roof apply no multiplier"; "Divide this damage into 5-point Damage Value groupings… For 'Mechs on the roof … Front column of the Hit Location Table; for 'Mechs inside … Front column of the **Punch** Hit Location Table"; "Falling: 'Mechs occupying a building level higher than 0 … suffer standard falling damage … **in addition**".
- Code: `levelsAbove = building.levels - 1` for every occupant (assumes everyone is at Level 0; a roof occupant gets the full multiplier, a Level 2 occupant of a 3-level building gets 2 instead of 1); applies one hit location roll for the whole amount; always uses the standard front table; never adds falling damage.
- Pinned by: `Buildings.test.js:170-175` pins the helper against the p73 example ✓, but nothing pins the caller.
- Fix: derive the occupant's building level, compute levels above = building levels − occupant level (0 on roof), split into 5-point groups, roll Punch table (interior) / standard Front (roof), and apply fall damage for level >0.

#### BLD-05 — Building entry only processed for the final hex; PSR misses the hexes-moved row and the charging/displacement cases
- Files: `Buildings.js:32-41`; `GameEngine.js:255-260` (destination only), `:987-989`.
- BMM p54/142 footnote 8 + Building Movement table: entering a building hex uses the "**Hexes moved in turn**" row (1–2:0, 3–4:+1, 5–6:+2, 7–9:+3, 10–17:+4, 18–24:+5, 25+:+6); "Add an additional +1 modifier if 'Mech is charging or being charged … A 'Mech displaced into a building automatically fails this PSR." p73 example: TN 7 = "5 (Piloting Skill) + 1 (four hexes moved, including the building hex) + 1 (Medium Building)".
- Code: only `entryPSRModifier(type)` is used; `hexesMoved` is set but never added (PSRCalculator ignores it); no +1 when charging/charged; no auto-fail on displacement. A path crossing two building hexes only triggers one PSR/damage.
- Pinned by: `tests/integration/urban.test.js:31-42` (CF only), `:44-62` (forced PSR failure); no TN assertions.
- Fix: process each building hex entered, add the hexes-moved row, charging +1, displaced auto-fail.

#### BLD-06 — Physical attacks against targets inside buildings are unrestricted
- Files: `PhysicalAttackResolver.js` (no building awareness) / `GameEngine.js:625-664`.
- BMM p72: "Physical Attacks: Physical attacks (other than charges) cannot be made against targets in a building hex, unless the attacker is in the same multi-hex building, on the same level, and is in a hex adjacent to the target."
- Code: any physical attack can be declared at a target in a building hex.
- Pinned by: none.
- Fix: reject non-charge physical attacks on building occupants unless same building/same level/adjacent.

#### BLD-07 — Other p72 combat-within-buildings effects missing
- Files: `Buildings.js:68-91`; `GameEngine.js:518-549`.
- BMM p72: "AE Damage: Area-effect attacks ignore the above damage reduction rules"; "Shots fired at a 'Mech inside a building hex that miss do not damage the building… The exception is if the attacker is adjacent to the building, in which case all missed shots automatically strike the building"; "Partial Cover: A standing 'Mech occupying a Level 1 building or a building hex only one level below the roof automatically receives partial cover… If the hit location roll indicates a leg, the attack strikes the building instead, damaging it as normal"; "If the target is in the same hex as the attacker, treat it as if it were in the attacker's forward arc."
- Code: reduction applies to every weapon type (including AE); missed shots never damage buildings (adjacent exception absent); partial-cover leg hits are absorbed but the building is not damaged; same-hex direction not forced to forward.
- Pinned by: `tests/integration/urban.test.js:229-242` (normal laser only).
- Fix: skip reduction for AE; on a miss with adjacent attacker charge the building; route partial-cover leg hits' damage to the building hex; force forward direction for same-hex attacks.

#### BAS-02 — A "No basement" result still produces a 1-level fall for overweight 'Mechs
- File: `Basements.js:23-27, 38-41` + `GameEngine.js:1014-1015` (`Math.max(1, hex.basement.depth)`).
- BMM p66: the fall is "through the floor **into a basement**"; the table's roll 5-8 is "No basement". The manual nowhere describes a sublevel fall where no basement exists.
- Code: when the roll says "none" but the 'Mech is heavier than the CF, it still falls 1 level (depth forced to 1) and takes fall damage.
- Pinned by: `tests/integration/urban.test.js:184-199` ("drops a Mech heavier than the hex CF even with no basement roll").
- Fix: if there is no basement, do not apply the basement fall (this may be a designer call — see "cannot verify").

### Low
#### PHY-12 — Target numbers are clamped to [2,12]

`PhysicalAttackResolver.js:593`. A 13+ TN (impossible on 2D6) becomes 12 and hits on a natural 12. No manual basis for clamping; pinned by `PhysicalAttackResolver.test.js:148-154`. Fix: clamp only the minimum at 2 (or leave >12 as an automatic miss).

#### PHY-13 — Absent actuators are not treated as damaged

`PhysicalAttackResolver.js:91-100, 117-128` via `UnitDamage.js:11-26` (only `status:'destroyed'`). BMM p48: "Some 'Mechs are designed without one or both hand actuators. The Target Number modifier for punch attacks … still applies … whether the actuator is destroyed or merely absent is irrelevant" and lower-arm "modifiers for damage reduction and physical attacks still apply". Fix: treat missing actuator slots as the same modifier.

#### PHY-14 — Option-table +4 applied even when the Different Levels table overrides it

`PhysicalAttackResolver.js:588-590`. BMM p38 footnote: "the +4 modifier does not apply when forced to roll on a Punch/Kick Location Table due to attacks from different levels". Code adds +4 with `usePunchTable` regardless of a level-forced table. Fix: only add +4 when the declared option table is the one actually used.

#### PHY-15 — Retractable blade blocked by a destroyed hand actuator

`PhysicalAttackResolver.js:121-123`. BMM p38 footnote: "Retractable Blade … *Not affected by an absent or damaged hand actuator", while p48 says a destroyed hand actuator blocks physical weapon attacks. p109 (absent) would settle it; flag as a rules conflict needing a ruling, not a silent p48-only implementation.

#### PHY-16 — Prone attacker: dead code vs rejection

every `resolve*` returns `'Attacker is prone'` (`:233-235, 287-289, 341-343, 463-465`), yet `calculatePhysicalTN` adds +2 for a prone attacker (`:572`) and a test asserts it (`PhysicalAttackResolver.test.js:143-146`). BMM p35 text is unavailable; the +2 is the p28 attacker-movement modifier. Fix once p35 is available: either delete the +2 path or implement the p35 prone-attack rules.

#### PHY-17 — Minor physical modifiers not wired

`PhysicalAttackResolver.js:25-32` lacks quad rear kick (+1, p38), moonless-night +1 for physical attacks (p29/138), and unintentional charge +3 (p29/138). Pinned by: none; roadmap p270 already notes the moonless-night helper is unwired.

#### PHY-18 — Claws override the level-forced table

`PhysicalAttackResolver.js:518-520`. p38 says claws always use the Punch table, but p140's Different Levels row forces the Kick table when the target is 1 level higher (and the p38 footnote says the forced table wins). Fix: apply `_tableFor` after the weapon default.

#### BLD-08 — Invented default building levels; CF ranges not validated

`Buildings.js:26-30` + `terrain.json:112-137` assign levels 1/2/3/4 per type. BMM p66: "Default Values: If a scenario does not specify a building's type, treat it as medium, **Level 2**"; p140 only gives CF ranges (1–15/16–40/41–90/91–150). `validate()` checks CF >0 but not the type range. Fix: default level 2 for unspecified buildings; validate CF against the type range.

#### BAS-03 — Basement fall uses the front hit table instead of the Facing After Fall table

`GameEngine.js:1017-1019`. BMM p66: "Use the Facing After Fall Table (see p. 57) to determine the 'Mech's resulting facing and which facing to apply the fall damage to." Code always uses `determineHitLocation(roll,'front')`. Fix: roll 1D6 on the Facing After Fall table (p143) and apply to that column.

#### X-01 [cross-module note, consolidated → C-01; not counted] — `hitTables.hitLocation.left` and `.right` are wrong (HIGH)

BMM p139: Left Side column = 2 LT, 3 LL, 4 LA, 5 LA, 6 LL, 7 LT, 8 CT, 9 RT, 10 RA, 11 RL, 12 Head; Right Side = mirror (2 RT, 3 RL, 4 RA, 5 RA, 6 RL, 7 RT, 8 CT, 9 LT, 10 LA, 11 LL, 12 Head). `hitTables.json:39-110` has `left` as a copy of the Front column (3-6 = RA/RA/RL/RT) and `right` as its mirror. This feeds all side-arc weapon hits and `PhysicalAttackResolver._standardLocation` (physical weapons). `HitTables.test.js:74-143` pins the wrong data and even asserts the incorrect "weights right-side locations on low rolls" behaviour.

---

**Confirmed correct by the audit (no action):** base TN modifiers (punch 0, kick −2, push −1); punch 1/10 tons and kick 1/5 tons rounded up with cumulative halving (p38 example 1/4); charge `ceil(tonnage/10 × hexes)` and attacker `ceil(target/10)` (p38 JagerMech example 33/5); the seven modelled physical-weapon rows (p38); +2 per arm actuator, +1 hand, +1 foot, no kick with a hip hit, shoulder blocks punch/weapon, fired-arm restrictions (p29/p38); DFA +3 and no terrain/attacker-movement modifiers (p36); physical-attack PSR consequences (p54); building CF defaults 15/40/90/120, entry damage, damage reduction and collapse/basement examples (p66/p72/p73), except the findings above.

## 3.4 Heat, MechWarrior damage and phase sequence (t4)

**Audited:** `src/rules/heat/{HeatManager,HeatScale}.js`, `src/engine/{PhaseManager,InitiativeManager}.js`, `src/models/{GameState,Unit}.js`, heat data and engine tests as evidence.
**Counts:** 1 blocker, 8 high, 9 medium, 7 low.
**Consolidation:** H-03 = F-01 (t5); the cross-domain notes printed by t4 (pilot-hit TN modifier, immobile modifier, fall pilot hit, cockpit kill, run-MP derivation) are folded into C-20, C-21, M-22, H-05 and M-13 and are not counted twice.
**KB coverage:** the KB has no chunk for p51 (and other odd pages in this range are missing), although some spreads include the facing page (e.g. the p16 chunk contains p17); findings that depend on p51 are marked *cannot verify* in the finding and listed in §4.4.

### Heat-scale threshold check

| Heat | Manual (KB) | heatScale.json | Verdict |
|---|---|---|---|
| 5 | Walk MP −1 — p52 ex.: Hatamoto at 9 heat "must reduce its Walking MP by 1"; "until its heat falls below 10" | movementPenalty 1 | OK (5–9 band) |
| 8 | "At 8, 13, 17, and 24 heat points, add the number indicated… at 8 heat points, add 1" (p52) | toHit 1 | OK |
| 10 | −2 Walk (p52 ex.: at 14 heat "Walking MP is still reduced by 1 more, to 2") | movementPenalty 2 | OK (10–14 band) |
| 13 | +2 TN (p52 ex.: at 14 heat "+2 Target Number modifier") | toHit 2 | OK |
| 14 | "…must make a 2D6 roll of 4 or higher to avoid shutdown" (p52 ex.) | shutdownAvoid 4 | OK |
| 15 | movement −3 | movementPenalty 3 | **cannot verify** (p51 body absent) |
| 17 | threshold listed p52; value not stated | toHit 3 | threshold OK; **value cannot verify** |
| 18 | threshold listed "14, 18, 22, 26 and 30" (p52); value not stated | shutdownAvoid 6 | threshold OK; **value cannot verify** |
| 19 | "a 'Mech with 19-22 heat would need a 4+" (p52) | ammoExplosionAvoid 4 | OK |
| 20 | movement −4 | movementPenalty 4 | **cannot verify** (p51) |
| 22 | p131: "a player whose 'Mech is at 22 heat would have to make two rolls, one needing an 8+ to avoid shutting down, and the other at 4+ to avoid an ammo explosion" | shutdownAvoid 8 | OK |
| 23 | "23-27 heat a 6+" (p52) | ammoExplosionAvoid 6 | OK |
| 24 | threshold listed p52; value not stated | toHit 4 | threshold OK; **value cannot verify** |
| 25 | movement −5 | movementPenalty 5 | **cannot verify** (p51) |
| 26 | threshold listed (p52); value not stated | shutdownAvoid 10 | threshold OK; **value cannot verify** |
| 28 | "28-30 heat an 8+" (p52) | ammoExplosionAvoid 8 | OK |
| 29 | **no such step in any KB page** ("At 14, 18, 22, 26 and 30 heat points…", p52) | shutdownAvoid 10 (duplicate of 26) | redundant/fabricated → H-19 |
| 30 | "shutdown cannot be avoided at 30 or more heat points" (p52) | autoShutdown | OK |

The cumulative fold in `HeatScale.js:38-43` is correct and matches the manual's non-cumulative wording ("these effects are not cumulative, and disappear when heat build-up is reduced", p52). The table itself is largely faithful; the failures are in generation, timing, restart, ammo, water cooling and the pilot/phase layer.

### Findings
#### H-01 · blocker · Movement heat is never generated in play
- Where: `src/rules/heat/HeatManager.js:30-56`; no production call site (only tests). `src/engine/GameEngine.js:496` is the **only** `heat +=` in src.
- Manual p50: "Walking: Walking generates 1 heat point, no matter how many MP the 'Mech expends or how many hexes it moves. Running: Running generates 2 heat points… Jumping: Standard jump jets generate 1 heat point per Jumping MP expended, with a minimum of 3 heat points." (Heat Point Table repeats the row values; p143 also prints the table.)
- Code: `calculateHeatGeneration()` computes weapon + walk/run/jump + engine + external heat, but nothing in `src/` calls it (grep: HeatManager.test.js and Modifiers.test.js only). Moving a 'Mech changes `position`/`hexesMoved` but never `unit.heat`. Heat therefore only ever comes from weapon fire (and weather), so walking/running/jumping never build heat.
- Pinned by: `tests/rules/heat/HeatManager.test.js:52-93` (unit-test of the dead function only); `tests/integration/heatScale.test.js:514-538` asserts only weapon heat through the engine. Nothing asserts movement heat end-to-end.
- Fix: call `calculateHeatGeneration` from the turn pipeline (movement confirmation or heat phase) and/or add movement heat in `_handleMove` per the table; add an integration test "Atlas walks → heat phase records +1".

#### H-02 · high · Engine-critical heat never applied; and the function lacks the shut-down exclusion
- Where: `src/rules/heat/HeatManager.js:63-66`.
- Manual p50: "The first engine hit to a 'Mech generates 5 points of heat per turn. The second hit raises this to 10 (total) points of heat per turn. This is not applied if the 'Mech is shut down." p52: "Engine critical hits do not generate heat while a 'Mech is shut down."
- Code: +5/+10 is computed inside the dead `calculateHeatGeneration` (H-01), so an engine-critted 'Mech never gains the heat; and there is no `unit.shutdown` guard, so wiring it up naively would heat a shut-down reactor.
- Pinned by: `tests/rules/combat/Modifiers.test.js:280-290` (calls the dead function directly).
- Fix: add engine heat in the Heat Phase (not at crit time), guarded by `!unit.shutdown`.

#### H-03 · high · Fire/external heat never reaches the Heat Scale; the 15-point outside-heat cap is missing
- Where: `src/rules/heat/HeatManager.js:58-61` (`unit._externalHeat` — never assigned anywhere in src); `src/engine/PhaseManager.js:244-248`; `src/engine/GameEngine.js:821-840` (`resolveFireDamage` rolls `fireDamageRoll` = 1D6 *damage*).
- Manual p50: "Fire: During the Heat Phase, a 'Mech in a burning hex absorbs an additional 5 Heat Points. A 'Mech also absorbs 2 Heat Points for each burning hex it moved through during the Movement Phase." — "Outside Heat Sources: … These heat sources are cumulative, to a maximum of 15 heat points in a single turn."
- Code: standing in fire does 1D6 points of *damage* (FireRules.js:105) instead of +5 heat; there is no producer of `_externalHeat`; no 15-point cap anywhere; weather heat (`HeatManager.js:197-200`) is added without counting toward that cap.
- Pinned by: `tests/rules/heat/HeatManager.test.js:81-85` sets `_externalHeat` by hand — nothing drives it from fire/plasma.
- Fix: in `resolveHeatPhase`, add +5 for a fire hex (and +2 per burning hex moved through), keep a single outside-heat accumulator capped at 15/turn (weather + fire + plasma), then dissipate.

#### H-04 · high · Consciousness rolls happen in the wrong phase, repeat every turn for a conscious pilot, and recovery is impossible
- Where: `src/engine/PhaseManager.js:281-313`.
- Manual p58: "Every time a warrior takes a point of damage, its controller must immediately make a Consciousness Roll… If the roll result is equal to or greater than the MechWarrior's consciousness number, the warrior remains conscious." p12: "After all attacks have been resolved, all Consciousness Rolls required due to damage inflicted in this phase are made." p12 End Phase (mandatory): "Any MechWarrior who was unconscious during the Initiative Phase of this turn rolls 2D6 to see if they regain consciousness." p58: "Recovering Consciousness: During the End Phase of each turn after the turn in which the MechWarrior lost consciousness, the player rolls 2D6. If the result is equal to or greater than the consciousness number for the warrior's current total damage points, the warrior regains consciousness. The player need not roll again to determine unconsciousness until the warrior takes new damage."
- Code: the only consciousness code is a loop in `_enterEndPhase` that rolls for units with `pilot.hits > 0 && pilot.conscious`. Consequences: (a) taking damage never triggers an immediate roll; (b) a *conscious* pilot re-rolls every single End Phase even with no new damage (a 1-hit pilot is knocked out ~5.6% of turns for no reason); (c) an unconscious pilot can never wake up because the guard requires `conscious === true`; (d) the table itself `[0,3,5,7,10,11]` and the `<` comparison are correct.
- Pinned by: `tests/engine/phaseSystem.test.js:472-613`; `tests/integration/fullTurn.test.js:200-226`; `tests/integration/phaseStateMachine.test.js:415-536` — all assert "consciousness checks in end phase".
- Fix: roll consciousness at damage time (or as the p12 end-of-attack-phase step) and make the End Phase roll a *recovery* roll for unconscious pilots, using the same 3/5/7/10/11 ladder and skipping pilots knocked out that same turn.

#### H-05 · high · 6 hits is "auto unconscious" rather than dead, a dead warrior's 'Mech is never removed, and head destruction does not kill the pilot
- Where: `src/engine/PhaseManager.js:284-298` (`[0,3,5,7,10,11,null]`, `null` → auto unconscious); `src/models/Unit.js:111-122` (`pilot.dead = true` is write-only — grep shows no reader); `src/rules/combat/DamageResolver.js:215-220` (head/CT destruction sets `unit.destroyed = true`, not pilot death).
- Manual p58: "A warrior that takes 6 points of damage is dead. Remove the MechWarrior's 'Mech from the map in the end of the phase in which they were killed." p44: "If a head has all its internal structure destroyed, the MechWarrior inside is killed and the 'Mech is destroyed. Remove the 'Mech from the map in the end of the phase in which it was destroyed."
- Code: `applyPilotDamage` clamps at 6 and sets `pilot.dead`, but nothing reads `dead`, no `unitDestroyed` is emitted, and the unit stays in `state.units` and in the action queue — so a warrior killed by head hits/heat/ammo explosion keeps fighting the 'Mech at full effect. Head destruction marks the unit destroyed but leaves the pilot alive.
- Pinned by: `tests/integration/fullTurn.test.js:228-247` ("a pilot with six hits is out of the fight" only asserts `conscious === false`).
- Fix: one kill path — 6th hit, cockpit crit, head destruction → mark pilot dead, emit `unitDestroyed`, remove at end of the current phase.

#### H-06 · high · A shut-down 'Mech (and an unconscious pilot's 'Mech) can still move, fire and act
- Where: `src/engine/PhaseManager.js:352-390` (`validateAction` checks only phase + queue; `unit.immobile` is declared at `Unit.js:43` and never set); `GameEngine._handleMove`/`_handleFire` contain no `shutdown`/`conscious` check.
- Manual p52: "A shutdown 'Mech becomes immobile (see p. 18). Its equipment ceases to function except for heat sinks and life support, and it cannot attack or take any other action." p58: "A 'Mech with an unconscious warrior becomes immobile (see p.18). The 'Mech cannot move, fire, or take any other action, though its player can still assign it a movement selection."
- Code: shut-down and unconscious-pilot units are fully playable; the only heat-shutdown consequence implemented is the attacker's −4 TN when shooting *at* such a unit (`AttackResolver.js:88-91`).
- Pinned by: `tests/integration/heatScale.test.js:540-566` only asserts the −4 to-hit against a shut-down target.
- Fix: derive `immobile` from shutdown / `!pilot.conscious` (and 0 MP per p18) and reject `move`/`fire`/`physicalAttack` for immobile units, while still allowing the movement selection to be consumed.

#### H-07 · high · Restart rule is wrong: flat 8+ in the End Phase, no automatic restart below 14, no block at 30+
- Where: `src/engine/PhaseManager.js:315-326`.
- Manual p52: "A conscious MechWarrior can attempt to restart their power plant during in any subsequent Heat Phase. To do this, the player first records Heat Scale changes for the turn, and then rolls 2D6. If the result is equal to or greater than the highest current Avoid Target Number, the power plant restarts." — "When the heat drops below 14 on the Heat Scale, the power plant restarts automatically, even if the pilot is out of action." — "Overflow Heat: A 'Mech's Heat Scale must be below 30 before a restart can occur." p12 (Heat Phase): "'Mechs shutdown due to heat make their restart attempts in this phase."
- Code: every shut-down unit rolls `2D6 >= 8` in the End Phase. So a heat shutdown at 14 heat needs 8+ instead of 4+, a unit that has cooled to 5 still needs 8+ instead of restarting automatically, a unit at 31 heat may restart (forbidden), and the heat-shutdown attempt is in the wrong phase. The only correct part is that heat-shutdown attempts belong after the heat adjustments (which happen in the previous phase).
- Pinned by: `tests/engine/phaseSystem.test.js:619-690`; `tests/integration/fullTurn.test.js:249-298`; `tests/integration/phaseStateMachine.test.js:541-590`.
- Fix: heat-shutdown restart inside the Heat Phase using the unit's current highest `shutdownAvoid`; auto-restart below 14; refuse at ≥30; conscious pilot required; keep the voluntary-shutdown restart in the End Phase.

#### H-08 · high · Heat-induced ammo explosion does no damage to the 'Mech
- Where: `src/rules/heat/HeatManager.js:215-228` (zeroes `shots`, calls `applyPilotDamage(2)`, emits a string; nothing else).
- Manual p52: "When an overheated 'Mech's ammo explodes, the ammunition critical slot with the most destructive ammo per shot explodes first… All of the appropriate ammo type in a single critical slot explodes… Resolve the explosion following the rules in Critical Hit Effects, page 45." (i.e. shots × damage-per-shot to the location, CASE applies; p96 ammunition.)
- Code: `DamageResolver.resolveAmmoExplosion` knows how to do this (shots × weapon damage, CASE, internal structure), but the heat path never calls it. An overheat ammo explosion is therefore harmless to the 'Mech while a crit-triggered explosion is lethal — an inconsistency as well as a rules bug.
- Pinned by: `tests/integration/heatScale.test.js:56-78, 178-192`; `tests/rules/heat/HeatManager.test.js:278-330` — all assert only that the bin's shots reach 0.
- Fix: share one explosion resolver between crit hits and heat, and apply the damage to the bin's location.

#### H-09 · medium · Water cooling: +1 per leg sink regardless of single/double, and no 6-point cap
- Where: `src/rules/heat/HeatManager.js:102-117` (`dissipation += legSinks`).
- Manual p50 Heat Point Table: "–1 additional per operational single heat sink under water (maximum 6 points) –2 additional per operational double heat sink underwater (maximum 6 points)."
- Code: one extra point per leg sink whatever its type, uncapped. A double-sink 'Mech gets half the manual's bonus; a 'Mech with 7+ submerged leg sinks dissipates more than the rule allows.
- Pinned by: `tests/rules/heat/HeatManager.test.js:111-121` (expects 13 = 10+3); `tests/integration/heatScale.test.js:452-462` ("water bonus stacks with double heat sinks correctly" expects heat 17, i.e. +3 not +6).
- Fix: +1/single, +2/double, `Math.min(6, extra)`; keep the "operational, in the legs" filter.

#### H-10 · medium · Physical Attack Phase order is reversed: winner declares first, manual repeats the Weapon Attack Phase (loser first)
- Where: `src/engine/PhaseManager.js:210-229` (queue built `(winnerPlayer, loser)`; comment line 219); `src/engine/InitiativeManager.js:55-57` returns `[winner, loser]` for `physical_attack`.
- Manual p12: "PHYSICAL ATTACK PHASE: Players repeat the steps given for the Weapon Attack Phase, except for torso twisting, with all damage from physical attacks taking effect before the Heat Phase." p10 Weapon Attack Phase: "The side that lost Initiative must act first."
- Code: the winner always declares physical attacks first, and the choice logic is deliberately bypassed.
- Pinned by: `tests/integration/phaseStateMachine.test.js:138-147`; `tests/integration/gameEngineFlow.test.js:295-301`; `tests/integration/twoMechCombat.test.js:82` — all named "winner first".
- Fix: build the physical queue exactly like movement/weapon_attack (loser first) and align `getInitiativeOrder`.

#### H-11 · medium · Initiative winner may choose to act first; the manual mandates that the loser acts first
- Where: `src/engine/PhaseManager.js:27-33` (`chooseInitiative`), applied at lines 158-160 and 196-197.
- Manual p10: "The side that lost Initiative must act first." (Movement; the Weapon Attack Phase repeats it.) Nothing in p10/p12 gives the winner a choice; p10's only "choices" are deployment side and the optional Alternate Initiative/Moving Multiple 'Mechs.
- Code: `initiativeWinnerGoesFirst` flips the movement and weapon-attack order for the whole turn. If this is a deliberate house rule it must be labelled as one; as coded it is presented as the rule.
- Pinned by: `tests/integration/gameEngineFlow.test.js:271-293`; `tests/integration/phaseStateMachine.test.js:102-136`; `tests/integration/fullTurn.test.js:110-141`.
- Fix: remove the choice (loser always first), or gate it behind an explicit optional-rule flag.

#### H-12 · medium · Unequal force sizes are not handled: the queue is a fixed 1:1 alternation
- Where: `src/engine/PhaseManager.js:38-56` (`buildUnitQueue` interleaves first[i], second[i] for the whole phase).
- Manual p12: "If, prior to any pair of movement or attack declarations, one team has at least twice as many 'Mechs left to declare for as the other team, the team with twice as many 'Mechs declares for two 'Mechs each time, rather than one. If one team has at least three times as many 'Mechs, it declares for three each time, and so on." (The page then prints the two worked tables, e.g. 10 vs 18 → 1:1 until 8 vs 16, then 1:2.)
- Code: the ratio is computed once, as 1:1, and never re-evaluated against remaining counts; a 10-vs-18 game never lets side B declare two per pair.
- Pinned by: `tests/engine/phaseSystem.test.js:43-90`; `tests/integration/phaseStateMachine.test.js:155-165`.
- Fix: recompute the declaration ratio from units still to declare before each pair (or rebuild the queue dynamically).

#### H-13 · medium · No victory or draw detection
- Where: `src/models/GameState.js` (no winner/ended state); `src/engine/PhaseManager.js:395-414` (the turn loop never checks survivors).
- Manual p12: "Players repeat the sequence of play given above until one side achieves victory. Under normal circumstances, the side with the last surviving 'Mech(s) on the map wins. If the last 'Mechs from each side are destroyed simultaneously in the same turn, or if the last 'Mechs from each side cannot move and have no ability to damage one another, the game is a draw."
- Code: the engine loops phases and increments `turn` forever; nothing evaluates survivors or declares a result.
- Pinned by: none.
- Fix: evaluate victory/draw at the end of each turn (and on each destruction) and expose a game-over state.

#### H-14 · high · Destroyed 'Mechs are never removed and stay in the action queue
- Where: `src/engine/PhaseManager.js:38-56` (no `isDestroyed()` filter); destroyed units are never deleted from `GameState.units` (grep: no removal anywhere in `src/`); `GameEngine._handleFire` never checks the attacker's `isDestroyed()`.
- Manual p10: "A player may assign a movement action to any 'Mech that has not been destroyed, even if it is completely immobile." p131 (misconception 7): "Destroyed 'Mechs are removed from the map. Their carcasses have no effect on the game."
- Code: a head/CT-destroyed 'Mech still occupies its hex, is still counted for stacking/LOS, still gets a queue slot each phase, and can still be ordered to fire (heat, ammo and pilot damage included).
- Pinned by: none (tests destroy units but never assert removal).
- Fix: remove destroyed units at the end of the phase in which they die and exclude them from queue building and action validation.

#### H-15 · medium · Involuntary shutdown always knocks the 'Mech prone (the +3 PSR is auto-failed) and the fall's pilot damage is missing
- Where: `src/engine/PhaseManager.js:252-259` calls `makePSR(..., [{trigger:'Involuntary shutdown', baseModifier:3}])` **after** `resolveHeatPhase` has set `unit.shutdown = true`; `src/rules/movement/PSRCalculator.js:123-127` returns `targetNumber: 999` for any shut-down unit before applying modifiers.
- Manual p52: "If a 'Mech shuts down involuntarily, a Piloting Skill Roll (see p. 53) is immediately required, with a +3 Target Number modifier. Regardless of how it shut down, **any other** PSR required while shutdown fails automatically." p54/p142 footnote 2: "…in either case, if the 'Mech falls, the warrior automatically takes 1 point of damage."
- Code: the shutdown PSR can never be rolled (auto-fail), so every involuntary shutdown sets `prone = true` without a roll; and no pilot damage is applied for the fall.
- Pinned by: none (no test asserts the involuntary-shutdown PSR/fall).
- Fix: roll the shutdown PSR explicitly (bypass the "shutdown auto-fails" rule, which applies to *other* PSRs) and apply 1 pilot damage when it fails.

#### H-16 · medium · Heat is added at fire time, so weapon TNs drift within the Weapon Attack Phase
- Where: `src/engine/GameEngine.js:496` (`attacker.heat += weaponDef.heat + quirkHeatModifier(...)`), consumed by `AttackResolver.getHeatModifier` (`AttackResolver.js:476-478`) during the same phase; `HeatManager.resolveHeatPhase` only dissipates.
- Manual p52 example: "A Hatamoto-Chi begins a turn with a Heat Scale level of 4. During the turn, the 'Mech fires both its PPCs and walks (generating 21 heat points)… During the Heat Phase, these 5 points are added to the 4 already on its Heat Scale, bringing the total to 9. **In the next turn**, the 'Mech must reduce its Walking MP by 1 … and add +1 to its Target Number for weapon attacks."
- Code: the heat scale is mutated as each weapon is declared, so the second weapon fired in the same phase already pays the heat TN of the first (e.g. a PPC then an AC/20 at heat 10 → +1 on the AC/20), and a mid-phase save persists heat that should not exist yet.
- Pinned by: `tests/integration/heatScale.test.js:568-612` (pre-sets `unit.heat`, so it cannot see the drift).
- Fix: accumulate `pendingHeat` during the turn and fold it into the Heat Scale in the Heat Phase; MP/TN read only the recorded scale.

#### H-17 · medium · Shutdown-avoid and restart rolls ignore whether the MechWarrior is conscious
- Where: `src/rules/heat/HeatManager.js:205-213`; `src/engine/PhaseManager.js:315-326`.
- Manual p52: "A **conscious** MechWarrior can override the power plant's safety shutdown procedure…" and "A **conscious** MechWarrior can attempt to restart their power plant…".
- Code: no `pilot.conscious` test in either path, so an unconscious pilot "avoids shutdown" on a lucky 2D6 and "restarts" on 8+.
- Pinned by: none.
- Fix: unconscious pilot → automatic shutdown at ≥14 heat and no restart attempt.

#### H-18 · medium · Ordering and unconscious-PSR rules are not implemented (consciousness before PSR; unconscious PSRs auto-fail)
- Where: `src/engine/PhaseManager.js` (no end-of-Weapon-Attack-Phase consciousness step); `src/rules/movement/PSRCalculator.js:123-127` checks `unit.shutdown` but never `unit.pilot.conscious`.
- Manual p58: "If a MechWarrior is forced to make both a Consciousness Roll and a PSR at the same time, the Consciousness Roll always comes first. All PSRs required of an unconscious MechWarrior automatically fail." p12: "After all attacks have been resolved, all Consciousness Rolls required due to damage inflicted in this phase are made … After this comes all Piloting Skill Rolls required."
- Code: PSRs resolve with no preceding consciousness step, and a 'Mech whose pilot is out still rolls (and can pass) PSRs.
- Pinned by: none.
- Fix: insert the consciousness step before PSR resolution and make `PSRCalculator` return auto-fail when `!unit.pilot.conscious` (p58, p18).

#### H-19 · low · heatScale.json adds a heat-29 row that no manual page contains
- Where: `src/data/heatScale.json:21` (`{ "heat": 29, "shutdownAvoid": 10 }`).
- Manual p52: "At 14, 18, 22, 26 and 30 heat points, a 'Mech attempts to shutdown…" (no 29). The printed Heat Scale body would be p51/p8; p8 only describes the scale, it does not print the ladder, so the KB cannot confirm a 29 row.
- Code: identical value to the 26 step, so behaviour is unchanged — dead/possibly invented data that will mislead future audits.
- Pinned by: `tests/rules/heat/HeatManager.test.js:145-169` restates the JSON row-for-row, so it locks the extra row in.
- Fix: delete the 29 step (or annotate it as a duplicate if the printed scale really shows it).

#### H-20 · low · Ammo-bin selection ignores the manual's player choice and the explosive filter
- Where: `src/rules/heat/HeatManager.js:75-93` (`score = perShot * 1000 + shots`, picks highest score; ignores `bin.explosive`), used at 215-228.
- Manual p52: "When the 'Mech carries two ammo slots with equivalent per-shot Damage Values, **the 'Mech's controlling player chooses** which ammo explodes." — "If two or more locations have an equal number of shots remaining, randomly determine which one explodes." — "Exploding weapons and their ammunition (such as Gauss rifles), as well as all One-Shot (OS) type weapons, do not explode from overheating."
- Code: deterministic "most shots" tie-break where the player should choose; no `explosive` filter (every bin in `mechs.json` happens to carry `explosive: true`, so the Gauss/OS rule is latent rather than visible).
- Pinned by: `tests/integration/heatScale.test.js:178-192` (only covers distinct per-shot damage).
- Fix: pick per-shot damage, then player choice / random on ties; skip `explosive: false` bins.

#### H-21 · low · Inferno ammunition's extra Avoid rolls are absent
- Where: `src/rules/heat/HeatManager.js:215-228` (single ammo check).
- Manual p52: "A 'Mech carrying Inferno ammunition must roll an additional set of Heat Scale Avoid Rolls to determine whether or not its inferno ammo explodes (see p. 107)."
- Code: none; and no inferno ammo exists in `weapons.json`/`mechs.json`, so this is latent.
- Pinned by: none.
- Fix: when inferno bins exist, run the extra avoid set (p107 is not in the KB — implement from the data model once added).

#### H-22 · low · End-Phase mandatory and optional heat-related actions are missing
- Where: `src/engine/PhaseManager.js:265-347` (only fire/support resolution, torso-twist and reversed-arms reset, restart, cleanup).
- Manual p12 End Phase / p48 / p50 / p52: "A pilot of a submerged 'Mech with critical damage to its life support system takes 1 damage"; "Heat sinks can be switched on or off"; "'Mechs can be voluntarily shut down, or restarted if voluntarily shut down in a previous End Phase"; "Players may elect to voluntarily shutdown their 'Mech during any End Phase."
- Code: no submerged-life-support damage, no heat-sink on/off state, no voluntary shutdown/restart action. Only the twist/reversed-arm resets (p12) are implemented, correctly.
- Pinned by: none.
- Fix: add the mandatory submerged damage and the optional toggles (or document them as deliberately out of scope).

#### H-23 · low · Torso-mounted cockpit and the ±5-heat life-support quirks are not modelled
- Where: `src/rules/heat/HeatManager.js:230-239` (standard 15-25 → 1, 26+ → 2 only).
- Manual p52: "If a 'Mech with a torso-mounted cockpit takes a life support critical hit, the MechWarrior instead suffers 1 point of damage at the end of every Heat Phase that the 'Mech's Heat Scale is between 1 and 14, and 2 points of damage at the end of every Heat Phase that the Heat Scale is 15 or higher." p88 Poor Life Support / p144 Improved Life Support: "…treat the 'Mech's heat level as being 5 points higher/lower".
- Code: neither cockpit variant nor either quirk exists in `src/` or `quirks.json`; the standard ladder itself is correct (15-25 → 1, 26+ → 2, applied at the end of every Heat Phase).
- Pinned by: none.
- Fix: add the cockpit variant and the two quirk hooks if/when those options are offered.

#### H-24 · low · Initiative ties end in a deterministic lowest-player-id winner; initiative modifiers are never applied
- Where: `src/engine/InitiativeManager.js:19-44`; `src/models/Unit.js:83` (`initiativeModifier` is never read anywhere).
- Manual p10: "…The side with the higher result wins Initiative for that turn. **Re-roll all ties.**" p144 Positive Quirk Table: "Battle Computer 5 — 'Mech provides a +2 Initiative bonus"; "Command 'Mech 2 — 'Mech provides a +1 Initiative bonus."
- Code: after 100 tie re-rolls the winner is the lowest player id (deliberate determinism fallback); no unit/force initiative modifier is ever added to the 2D6.
- Pinned by: `tests/engine/determinism.test.js:56-64` (pins the fallback).
- Fix: keep re-rolling (or make the fallback an explicit, documented house rule) and add the quirk initiative bonuses when quirks are modelled.

#### H-25 · low · `endPhase` bypasses the queue, so either player can end a phase mid-alternation
- Where: `src/engine/PhaseManager.js:355-358` ("endPhase and selectUnit bypass queue/player checks") → `GameEngine._handleEndPhase` calls `nextPhase()` immediately.
- Manual p10: "…with all players completing a phase before anyone moves onto the next phase."
- Code: either player can advance out of Movement/Weapon/Physical at any time, skipping the opponent's remaining selections.
- Pinned by: `tests/engine/phaseSystem.test.js` endPhase tests (assert the bypass is allowed).
- Fix: only allow `endPhase` when the current queue is exhausted (or from the player whose selection it is).

### Checked and compliant (t4 detail)
- `PHASES` order in `src/models/GameState.js:10-17` = initiative → movement → weapon_attack → physical_attack → heat → end, exactly p10's numbered list; `nextPhase()` starts a new turn after `end` with `turn++` (p10).
- Movement and Weapon Attack phases default to loser-first (`PhaseManager.js:149-208`) per p10; the initiative winner's forced choice is H-11 only.
- Heat scale values that the KB can confirm (5, 8, 10, 13, 14, 19, 22, 23, 28, 30) all match `heatScale.json`, and the cumulative fold is right (p52).
- Weapon-attack TN heat penalties apply only to weapon attacks: `AttackResolver.getHeatModifier` is used in the weapon path only; physical attacks never import `getHeatEffects` (p52: "These penalties apply only to weapon attacks, not physical attacks").
- Heat sinks keep working while shut down (`resolveHeatPhase` dissipates for shut-down units too) — p52 requires exactly that.
- Life-support heat damage ladder and timing (15-25 → 1, 26+ → 2, at the end of every Heat Phase) match p52/p48.
- `applyHeatDissipation` uses "operational" sinks (`count − damaged`, ×2 for double) — p50/p143 Heat Point Table ("–1 per operational heat sink, –2 per operational double heat sink").
- Head-hit pilot damage (`GameEngine.js:559-563`) matches p58 ("the MechWarrior takes 1 point of damage whenever the 'Mech's head takes a hit dealing 1 or more points of damage, even if the hit does not penetrate").
- Extreme-temperature heat (`WeatherRules.heatPerTurn`, `HeatManager.js:197-200`) matches p50 ("for every 10 degrees C (or fraction thereof) higher than 50 degrees, add 1 heat point per turn").
- End Phase returns twisted torsos and reversed arms to forward (p12), and the involuntary-shutdown +3 trigger is present (p52/p54) — the ordering bug is H-15.
- Jump heat `Math.max(3, hexes)` and walk 1 / run 2 match p50 (the values are right; they are simply never applied — H-01).

## 3.5 Battlefield layers: weather, fire, mines, support, quirks, visibility (t5)

**Audited:** `src/rules/weather/WeatherRules.js`, `src/rules/terrain/FireRules.js`, `src/rules/battlefield/{Minefields,BattlefieldSupport}.js`, `src/rules/quirks/Quirks.js`, `src/engine/visibility.js` (+ `src/engine/sync` tests as evidence).
**Counts:** 0 blockers, 0 high (F-01 consolidated into H-03), 18 medium, 8 low. The audit's own tally line (1 high / 14 medium / 6 low) undercounts its list; the counted values are used here.
**Id note:** t5 uses its own id space. `H-xx` here means hidden-’Mech findings (not the heat findings H-xx in §3.4); `M-xx` means minefield findings (not the movement findings M-xx in §3.1). Qualify an id by its section when cross-referencing.
**KB present:** p60, p62, p64, p76, p78, p82, p84, p86, p88, p94 (fragment), p143–p146; p28–29/p138 attack tables. **Absent:** p59, p61 (body), p63 (body), p75 (body), p77, p79, p89–93 (see Appendix A).

#### F-01 [HIGH, consolidated → H-03] Fire causes invented 1D6 armour damage; the manual's +5 heat rule is never applied.
- file: src/rules/terrain/FireRules.js:104-107 (fireDamageRoll), consumed at src/engine/GameEngine.js:820-842 (resolveFireDamage, called each Heat Phase from PhaseManager.js:245-246).
- Manual p50 (KB 25, "Other Heat"): "Fire: During the Heat Phase, a 'Mech in a burning hex absorbs an additional 5 Heat Points. A 'Mech also absorbs 2 Heat Points for each burning hex it moved through during the Movement Phase." p64 (KB 32): "a hex ignited during the Weapon Attack Phase of the turn is not affected by the fire until the Heat Phase of the following turn." No 1D6 damage roll appears anywhere in the KB fire text.
- Code: fireDamageRoll() returns roll1d6(); resolveFireDamage() rolls 1D6 + a 2D6 hit location and arms damage. Conversely HeatManager.js:58-61 reads unit._externalHeat, but nothing in src/ ever sets it (grep: only tests do), so a burning 'Mech never gains the 5 heat.
- Test that pins it: tests/integration/battlefield.test.js:126-134 "burns a unit standing in the fire" asserts armour changed.
- Fix: delete the armour-damage path; in the Heat Phase add +5 heat for standing in a burning hex and +2 per burning hex moved through (e.g. fireHeat() feeding HeatManager._externalHeat); add a heat-based test.

#### W-01 [MEDIUM] Night modifiers always apply — the "illuminated" exemption is not modelled.
- file: src/rules/weather/WeatherRules.js:59-71 (attack), 107-114 (movement); header lines 5-6 admit the gap.
- Manual p62 (KB 31): "FULL MOON NIGHT … Ignore this modifier if the target is illuminated." / "MOONLESS NIGHT … Ignore these modifiers if the target is illuminated." Movement Costs Table p136 footnote: "**A 'Mech with an activated searchlight ignores this penalty." p138 table: "Full Moon Night +2; ignore if the target is illuminated".
- Code: no illumination/searchlight input; the +2/+3 and +1/+2 MP always apply.
- Test: tests/rules/weather/WeatherRules.test.js:39-49 (heat reduction only); tests/integration/battlefield.test.js:44-51 asserts "Weather: +3" unconditionally.
- Fix: accept illuminated/targetIlluminated/searchlight and zero the night attack + MP modifiers; add tests for the exempt case.

#### W-02 [MEDIUM] Physical-attack weather modifier is dead code; moonless +1 never reaches a punch/kick.
- file: src/rules/weather/WeatherRules.js:101-104 (physicalAttackModifier) — imported only by tests; PhysicalAttackResolver has no weather call.
- Manual p62: "MOONLESS NIGHT Attack Target Number Modifier: +3 to all weapon attacks, and +1 to all physical attacks. Reduce each modifier by 1 for every 15 points of heat on the target 'Mech's heat scale (minimum of 0 in both)." p138 physical section: "Weather Conditions Moonless Night +1; ignore if the target is illuminated."
- Code: helper returns a flat +1 with no target-heat reduction and is never invoked; physical attacks are always weather-free.
- Test: tests/rules/weather/WeatherRules.test.js:74-77 pins the helper only.
- Fix: call it from PhysicalAttackResolver.calculateTargetNumber (pass target heat, illuminated flag) and assert the engine-level TN.

#### F-02 [MEDIUM] One burn predicate conflates ignition with fire spread → two Fire Table rows and the heavy-smoke rule are unreachable.
- file: src/rules/terrain/FireRules.js:29-33 (canBurn) + 16-24 (ENVIRONMENT); used for ignition (GameEngine.js:790-798) and spread (801-806).
- Manual p64 Fire Table: "Environment* Modifier: Woods +0, Jungle +1, Building: Light –2, Building: Medium –1, Building: Heavy +0, Building: Hardened +1" — heavy +0 / hardened +1 only make sense if those hexes can be ignited. Spread is separate: "A fire hex can spread if it has a neighboring hex downwind that can burn (a woods, jungle, or light or medium building hex)". The only text that could support the exclusion is the page-64 fragment "Buildings: Heavy and hardened buildings cannot catch fire in this fashion." — its antecedent ("this fashion") sits on missing p63, so it cannot be tied to weapon ignition.
- Code: canBurn() returns false for heavy/hardened buildings and for jungle; tests enshrine that.
- Test that pins it: tests/rules/terrain/FireRules.test.js:22-27 and :47 (heavy/hardened false/null).
- Fix: split canIgnite() (all Fire Table environments, woods/jungle/buildings incl. heavy/hardened) from canSpread() (woods, jungle, light/medium building only); cite the two different rules.

#### F-03 [MEDIUM] Fire smoke is always light; heavy smoke is impossible; smoke lifetime is an uncited constant.
- file: src/engine/GameEngine.js:780-785 (`state.smokeHexes[smokeKey] = { level: 'light', turnsRemaining: 6 }`).
- Manual p64: "Light vs. Heavy: Smoke generated in this fashion is always light smoke, unless a heavy or hardened building is burning, in which case it is heavy smoke." The manual also says the burning hex itself "cannot have smoke as well" (code skips only the same hex; it never clears pre-existing smoke when a hex ignites).
- Code: level is hard-coded 'light'; because F-02 forbids heavy/hardened buildings from burning, the "unless" branch can never fire. Duration 6 has no citation — the p61 Terrain Modifications body (light/heavy smoke) is absent from the KB.
- Test: tests/integration/battlefield.test.js:119-124 (only counts two smoke hexes); tests/engine/sync.test.js:60 pins the `{level:'light',turnsRemaining:6}` shape.
- Fix: derive level from the burning hex's building type; obtain p61 and cite the duration (or mark it a named assumption).

#### F-04 [MEDIUM] Fires can never be extinguished.
- file: no implementation (src/rules/terrain/FireRules.js has no extinguishing helper; GameEngine.resolveEndPhaseFire only ever adds hexes, line 816).
- Manual p64: "EXTINGUISHING FIRE: A fire will continue to burn for the rest of the game unless extinguished… If 40 or more points of damage from weapons of the area-effect Type are dealt to a hex on fire in a single phase, the fire is extinguished. Smoke: Remove any smoke produced by extinguished fire hexes during the End Phase of the turn the fire was extinguished."
- Test: none.
- Fix: track AE damage per fire hex per phase; at 40+ remove the fire and its smoke in the End Phase; test with a bombing/artillery AE strike.

#### S-01 [MEDIUM] Battlefield Support Point pool is a bare constant (12) with no citation and no scenario allocation.
- file: src/models/GameState.js:39-42 (`points: 12`), echoed by BattlefieldSupport.js:154-162 (`points: 0` default when created lazily).
- Manual p147 (KB 75) checklist: "Extraction Raid Support: 5 BSPs, Objective Raid Support: 12 BSPs, Diversionary Raid Support: 20 BSPs, Planetary Assault Support: 35 BSPs … *For every two maps beyond the first four, add 50% to the BSPs provided." (p75 "Before Play Begins" body is absent.)
- Code: scenario-independent 12; no helper for raid type or map count; no comment cites p75/p147.
- Tests that pin the constant: tests/rules/battlefield/Support.test.js:73 & :88; tests/integration/minefields.test.js:298 & :334 (comments say "12 - …").
- Fix: add bspForScenario(type, maps) implementing the p147 numbers (+50 % per 2 maps beyond 4); keep 12 as the documented default; test the five table values.

#### S-02 [MEDIUM] Defensive Aerospace Support is absent from the support table and from resolution.
- file: src/rules/battlefield/BattlefieldSupport.js:41-86 (no light/heavy air-cover rows); header says out of scope.
- Manual p78/146: "Defensive Aerospace Support Light Air Cover N/A N/A 1 … Light Strike 3, Light Bombing 4, Heavy Strike 9, Strafing/Heavy Bombing 11; Heavy Air Cover … 2 … Light Strike/Bombing 9, Heavy Strike 5, Strafing/Heavy Bombing 6." p76 (KB 39): "After a player announces all Offensive Aerospace Support they wish to use in a given turn, an opponent may reveal their selection(s) of a Defensive Aerospace Support (Light Air Cover) to remove the attack(s) … If the roll is successful, the opponent's Aerospace Support attack is completely nullified".
- Code: no rows, so 1/2 BSP air cover cannot be bought and p76's nullification can never happen.
- Test: none (Support.test.js:42-47 only asserts offensive `scatters`).
- Fix: add light_air_cover/heavy_air_cover rows with the per-attack TNs, plus a resolution step before offensive resolution.

#### S-03 [MEDIUM] Scattered strikes always use the front column, contradicting p76.
- file: src/rules/battlefield/BattlefieldSupport.js:382-387 (`collectHits({… isRear:false, automatic:true})`).
- Manual p76 (bombing): "…use the rules above for applying damage, but use a direction of attack as coming from the original targeted hex (i.e. do not roll the 1D6 to determine attack direction as for a normal attack)."
- Code comment admits "the simplified primitive resolves those hit locations on the front column".
- Test: tests/rules/battlefield/Support.test.js:163-186 asserts front-column automatic hits.
- Fix: compute front/rear from the original target hex to the scattered hex (the engine already has HexMath.directionBetween; hex tables have front/rear) instead of forcing front.

#### S-04 [MEDIUM] Bombing does not damage a building hex.
- file: src/engine/GameEngine.js:895-921 (applies attack hits to units only); BattlefieldSupport.js:280-311.
- Manual p76: "If the hex targeted by a bombing is a building hex, and there is a 'Mech in that building hex, the full damage is applied simultaneously to both the building and the 'Mech."
- Test: none.
- Fix: in resolveScheduledSupport, when category=aerospace/scatters (bombing) and the hex has a building, apply the same groupings to CF (reuse Buildings damage helper).

#### S-05 [MEDIUM] Strafing is one hex / one roll, not 1-5 hexes with a separate attack roll per 'Mech.
- file: src/rules/battlefield/BattlefieldSupport.js:58-61 (row), 326-367 (single 2D6 for the whole strike); header lines 24-25 admits it.
- Manual p76: "Upon the declaration of a strafing attack, a player must designate from one to five consecutive hexes, all in a straight line. When resolving the attack, the player makes a separate attack roll for every 'Mech in one of those five targeted hexes, against the Strafing Target Number of 7."
- Test: none (only the table row, Support.test.js:34-35).
- Fix: accept `hexKeys` (≤5, straight line), roll per unit in each hex, keep one-use expiry.

#### M-01 [MEDIUM, unverifiable] Minefield hits resolve on the Kick Location Table → a minefield can only ever hit legs.
- file: src/rules/battlefield/Minefields.js:133-138 (kickLocationTable) + 193-203.
- Manual: p79 body absent from the KB (KB has p78 then p80) — cannot verify the table. What is verifiable is that battlefield-support damage uses "a separate roll on the appropriate Hit Location column for each Damage Value grouping" (p76) and that the project's default column for a frontal hit is Front (hitTables.front). hitTables.kick maps every result 2-12 to leftLeg/rightLeg, so no minefield hit can ever reach a torso or the head.
- Test that pins it: tests/rules/battlefield/Minefields.test.js:73-99 (self-consistent against the kick table); tests/integration/minefields.test.js:144 comment says "front table 7" while expecting rightLeg — the comment is wrong and hides the assumption.
- Fix: obtain p79 (BMM) or TW p.??; until then, either use the Front column (consistent with support attacks) or mark the whole minefield damage path as an unverified assumption in the module docs AND fix the integration-test comment.

#### M-02 [MEDIUM] A direct p.79 quotation is used for a rule whose page is not in the KB; trigger timing/TN are equally unverified.
- file: src/rules/battlefield/Minefields.js:205-207: `// "If a minefield is triggered and inflicts damage … reduce the minefield's total Damage Value groupings by 1" (p.79).` Same claim in src/engine/GameEngine.js:360-365.
- Manual: no p79 chunk exists. The task brief explicitly warns that p79 is unavailable, so this is an unciteable quote dressed as a citation. Also unverified from KB: the 2D6 trigger roll against the density TN, the "jump only triggers the landing hex" rule (minefieldHexesEntered:127-131), and friendly-fire behaviour.
- Test: tests/rules/battlefield/Minefields.test.js:78-90 asserts strengthAfter = before-1.
- Fix: restate the decrement as an ASSUMPTION (like the hit-location note in the same file), list the trigger rules in a "pending p79 extract" block, and keep them out of any quoted-citation style.

#### S-06 [LOW] Copperhead and Illumination/Smoke artillery variants missing though p78 is quotable.
- file: src/rules/battlefield/BattlefieldSupport.js:62-73.
- Manual p78 (KB 40): "Variant Artillery—Copperhead … BSP costs are identical to the standard attacks. Damage Value Groupings … Thumper: 1; Sniper: 2; Long Tom: 3." Table: "(Illumination/Smoke) 8 …".
- Test: none.
- Fix: add copperhead (groupings 1/2/3) and illumination_smoke (TN 8, cost per table) entries or record the omission in a scope note with the p78 reference.

#### F-05 [LOW] "Plasma or Inferno = automatic" is an id-substring hack; the ammo layer doesn't exist.
- file: src/rules/terrain/FireRules.js:42-48 (`id.includes('inferno')`).
- Manual p64 Fire Table: "Plasma Weapon or Inferno Automatic".
- Code: works only if the weapon id contains "inferno"; weapons.json has no inferno/plasma entry and no munition model, so a real inferno-SRM load (srm2 + inferno ammo) would not be automatic. The passing test uses a synthetic id.
- Test: tests/rules/terrain/FireRules.test.js:38-41.
- Fix: branch on ammo/munition type once ammo selection lands; keep the id check as fallback and comment it.

#### F-06 [LOW] Fire TN clamped to 2 with no manual basis.
- file: src/rules/terrain/FireRules.js:70 (`Math.max(2, tn)`).
- Manual p64 footnote gives no minimum ("For every 10 degrees above 30 degrees Celsius, apply a –1 modifier"); a flamer in a light building at 40 °C would be 4-2-1 = 1.
- Test: none reaches the clamp (tests/rules/terrain/FireRules.test.js:51 is 5).
- Fix: either drop the clamp or document it as an engine-wide convention shared with AttackResolver (`Math.max(2, tn)`).

#### F-07 [LOW] Jungle is in the Fire Table and in the p64 spread list, but the terrain model has no jungle hex.
- file: src/rules/terrain/FireRules.js:16-24 (`jungle: 1` unreachable) vs src/data/terrain.json (no jungle key); canBurn also rejects it.
- Manual p64: "Jungle +1" (Fire Table) and "a woods, jungle, or light or medium building hex" (spread).
- Test: none (FireRules.test.js:12 builds light_woods only).
- Fix: add jungle terrain types or delete the unreachable row and record the gap.

#### Q-01 [MEDIUM] Quirk coverage is 9 negative quirks; every positive quirk (p82-86) and 20+ mechanical negative quirks (p145) are unimplemented, so the quirk engine can only penalise.
- file: src/data/quirks.json:13-119 (9 entries, all `type:"negative"`), src/rules/quirks/Quirks.js:8-12 (`rules` = target/psr/heat only).
- Manual p82-86: e.g. "ACCURATE WEAPON (VARIES) … all Target Numbers for that weapon receive a –1 modifier"; "IMPROVED TARGETING (3: SHORT, 4: MEDIUM, OR 5: LONG POINTS) … –1 modifier"; "STABLE (2 POINTS) … –1 Target Number modifier when forced to make a Piloting Skill Roll as a result of a physical attack". p145: "Ammunition Feed Problem 1 … Cooling System Flaws 3 … No Cooling Jacket 2 … Poor Performance 3 … Slow Traverse 1 …" etc.
- Code: the existing `target` rule would already carry a –1 modifier if such data existed; none does. Q-02 below makes adding one render badly.
- Test that locks the gap: tests/rules/quirks/Quirks.test.js:58-66 requires every quirk's `type` to be exactly 'negative' and `cost > 0`, so adding p84's Fine Manipulators (0) or a positive quirk fails the suite.
- Fix: add the positive quirks (negative modifiers) and the high-impact negatives; relax the test to `['positive','negative']` and `cost >= 0`.

#### Q-02 [LOW] describeModifier always renders "+n", so a positive quirk would print "+-1".
- file: src/rules/quirks/Quirks.js:130-134.
- Manual: positive quirks are –1 modifiers (p82-86 quotes above).
- Test: tests/rules/quirks/Quirks.test.js:180-184 asserts the literal "+1" strings.
- Fix: format sign from the value before positive quirks land.

#### Q-03 [LOW] Cramped Cockpit's Small Cockpit prohibition is not validated.
- file: src/data/quirks.json:74-83 (no incompatibility metadata), Quirks.js has no validation hook.
- Manual p86 (KB 44): "CRAMPED COCKPIT (2 POINTS) … This quirk cannot be applied to 'Mechs with a Small Cockpit."
- Test: none.
- Fix: add an `incompatibleWith` field and check it in roster validation.

#### H-01 [MEDIUM] No active-probe reveal.
- file: src/engine/visibility.js:9-16 (trigger list omits it); no `activeProbe` reference anywhere in src (only import/export names 'beagle_active_probe').
- Manual p82 (KB 42): "Active Probes: At the end of the Movement Phase, any hidden 'Mech within range of an enemy 'Mech's active probe and with line of sight to that enemy 'Mech is revealed."
- Test: none in tests/engine/visibilityReveal.test.js (its docblock claims to assert the p82 trigger list but omits this one).
- Fix: revealOnActiveProbe(state, probeId, range) called at end of Movement Phase for both players; test with a Beagle-equipped unit.

#### H-02 [MEDIUM] Point-blank shots unimplemented.
- file: src/engine/visibility.js:1-16 (header scope) + GameEngine._hiddenUnitBlockingMove (324-332); revealOnFire (164-172) only fires after `firedThisTurn` is set, so the "attack without revealing first" exception cannot be expressed.
- Manual p82: "POINT-BLANK SHOTS: A hidden 'Mech revealed by enemy movement may immediately make a special point-blank weapon attack against the 'Mech that revealed it … uses a Range of 1. Ignore Target Number modifiers for movement or terrain … A 'Mech making a point-blank shot cannot perform any other action for the remainder of that turn."
- Test: tests/engine/visibilityReveal.test.js:278-335 tests only the stop-short/reveal half.
- Fix: model the point-blank attack as a one-shot action attached to the reveal event (range 1, no movement/terrain mods), or document it beside the other out-of-scope items in the module header.

#### H-03 [MEDIUM] Hidden 'Mechs are counted in the movement/attack queue.
- file: src/engine/PhaseManager.js:38-56 (buildUnitQueue uses state.getPlayerUnits with no hidden filter).
- Manual p82: "Hidden 'Mechs are not counted when making movement or fire selections."
- Code: every hidden unit occupies a slot, so the alternating order (and the p12 "unequal numbers" multiplier, which is computed from the same lists) reflects units the opponent should not know about/act around.
- Test: none.
- Fix: exclude hidden units from the queue (they get no slot until revealed) and add an engine test that a hidden unit does not shift the alternation.

#### H-04 [MEDIUM] Hidden-placement legality (forbidden hexes) is never checked.
- file: src/models/GameState.js:100-111 (only isUnitHidden/revealUnit) — no setter or scenario validation; visibility.js has no placement API.
- Manual p82: "Forbidden Hexes: A 'Mech can only be hidden in a hex/level it can legally enter and could normally access if not hidden. No 'Mech may hide in a clear, paved, or road/bridge hex. 'Mechs may only be hidden in water hexes if fully submerged."
- Test: none.
- Fix: validate on registration (scenario setup / debug API): reject clear/paved/road/bridge, require fully-submerged water; add tests.

#### H-05 [MEDIUM] Offensive Aerospace Support is projected as secret, but p76 requires public announcement.
- file: src/engine/visibility.js:76-90 (projectBattlefieldSupport filters every strike by owner).
- Manual p76: "After a player announces all Offensive Aerospace Support they wish to use in a given turn, an opponent may reveal their selection(s) of a Defensive Aerospace Support (Light Air Cover) to remove the attack(s)." The module's rationale cites p77 "pre-designated artillery hexes" — that is artillery only; the p77 body is absent from the KB (unverified).
- Code: opponent never sees an offensive strike, so the defender can never react (and S-02 means there is nothing to react with).
- Test: tests/engine/sync.test.js:200-264 asserts the secrecy.
- Fix: make aerospace strikes public (with their target hex); keep only artillery target hexes owner-private.

#### H-06 [LOW] p82 timing/spotting details differ: reveal-on-fire happens after the shot, and hidden spotting/C3 is unmodelled.
- file: src/engine/visibility.js:164-172 (revealOnFire requires a fired declaration; GameEngine.js:514-516 calls it during resolution).
- Manual p82: "If a player plans to attack with a hidden 'Mech (not including a point-blank shot; see below), they must reveal it at the start of the Weapon Attack Phase." and "Hidden 'Mechs may not attack, but may spot for indirect fire and/or act as part of a C3 network."
- Test: tests/engine/visibilityReveal.test.js:545-643 pins the "has fired" semantics.
- Fix: reveal at declaration time; allow a hidden unit to spot/C3 without revealing.

#### H-07 [LOW] Unowned minefields are invisible to both players.
- file: src/engine/visibility.js:99-108 (filter by owner; unowned records dropped from every projection), documented at 94-97.
- Manual: p79 body absent; but p82 implies the owning player knows where their fields are. A field placed without `owner` still attacks (GameEngine._resolveMinefields) yet is never drawn for anyone.
- Test: tests/engine/sync.test.js:250-264 (ownerless strike hidden); no minefield projection test with an owner.
- Fix: require `owner` in placeMinefield (throw otherwise) or default it to the acting player, mirroring scheduleSupportStrike.

---

**Confirmed correct by the audit (no action):** weather attack/movement/PSR modifiers, dusk/full-moon/moonless heat offsets, rain/snow/fog and wind modifiers (p62/p136/p138); fire TNs 4/7/9, automatic plasma/inferno, environment table, spread on 12 and gale/storm 2 hexes, burning building −2 CF (p64); support table TNs/groupings/BSP costs, MoF scatter, per-grouping hit rolls, one-use expiry (p76/p78/p146); minefield density rows and 5-point groupings (p78); all nine negative quirks match p145 + p86/p88; the hidden-’Mech reveal list (own move, fire, adjacency, building entry, stop-short, jump landing, minefield exit, AE blast) matches p82; hidden-’Mech minefield exit (p82).

## 3.6 Data, import and export (t6)

**Audited:** `src/data/*.json`, `src/data/maps/*.json`, `src/import/{mtfParser,unitConverter,mulParser}.js`, `src/export/mtfExporter.js`, and the data/import/export tests as evidence.
**Counts:** 0 blockers, 4 high, 8 medium, 7 low (19 distinct). t6 reported 21 findings (2 “high-blocking”, 4 high, 8 medium, 7 low); D-03 and D-04 are consolidated into C-01 and PHY-01.
**Note:** D-13 is a compound terrain finding whose items 1–3 and 5 restate M-01/M-31/M-37/BLD-01; it is retained once here for the rubble-height and missing-terrain items. The full standalone report is `docs/audit-t6-data-import-export.md`; the findings and verified list below are its sections A and B.

### Findings (ranked)
Severity scale: blocker / high / medium / low.

---

#### D-01 — `small_laser` is used by four roster units but does not exist in `weapons.json`

* **Severity:** high
* **File:line:** `src/data/mechs.json:4182, 4239, 4561, 4565` (Warhammer WHM-6D), `:5839, 6290`
  (Banshee BNC-3E), `:6400, 6854` (Awesome AWS-8Q), `:7568, 8019` (Banshee refit) —
  `src/data/weapons.json` (no `small_laser` entry; 17 weapons listed, lines 2–258).
* **Manual (p121, Inner Sphere Weapons):** `Small Laser DE 1 3 0 1 2 3 0.5 1 — 100`
  (Heat 1, Damage 3, Minimum 0, Short 1, Medium 2, Long 3, 0.5 tons, 1 crit).
* **Code behaviour:** `src/main.js:326` does `weaponsLookup[weaponType]`, which is `undefined` for
  `small_laser`, but both UI paths guard the lookup — `src/main.js:327` and `src/ui/UIController.js:189`
  execute `if (!weaponDef) continue;` — so the weapon is silently skipped and the laser cannot fire.
  `GameEngine.resolveWeaponAttack` is never reached with an `undefined` weapon (its `weaponDef.usesAmmo()`
  at `:464` and `weaponDef.heat` at `:496` are therefore not a crash path in the current UI). There is
  no fallback stats path; the Warhammer, Banshee and Awesome lose those lasers without an error.
  A grep of `src/` finds exactly one production call into `AttackResolver.resolveWeaponAttack`
  (`GameEngine.js:482`), reached from those two guarded UI paths; no unguarded production caller exists.
* **Pinning test:** none. `tests/data/mechs.test.js:156-173` only checks that `ammoBin` references
  resolve; nothing asserts that `equipment.weapons[].type` exists in `weapons.json`.
* **Recommended fix:** add `small_laser` (`type:"DE"`, heat 1, damage 3, min 0, 1/2/3, 1 crit,
  0.5 t) to `weapons.json`, and add a data-integrity test that every weapon id used by any mech
  resolves in `weapons.json` (the same test would have caught D-02).

---

#### D-02 — Atlas AS7-D lists an SRM-6 that has no critical slot anywhere

* **Severity:** high
* **File:line:** `src/data/mechs.json:547-551` (weapon `srm6` @ `leftTorso`, `ammoBin: srm6_ammo`);
  the `leftTorso` critical section for both Atlas entries holds only `lrm20` ×5, `lrm20_ammo` ×2 and
  `heat_sink` ×5 (12 slots). `"item": "srm6"` never appears in either Atlas entry — only
  `"item": "srm6_ammo"` at `:137` and `:142` (and `:7021`/`:7026` for the refit).
* **Manual (p6, SLOT):** "Slots are where the weapons, equipment, and structural components that make
  up a ’Mech are placed. When critical hits are assigned, they are assigned to specific slots,
  disabling or even potentially exploding whatever is in that slot". Also p96 "Critical Hit
  Effects: A critical hit (see p. 45) to any slot of an item destroys that item."
* **Code behaviour:** `Unit.getWeaponsByLocation()` (`src/models/Unit.js:197`) reads
  `equipment.weapons`, so the SRM-6 fires normally, but `DamageResolver` only ever destroys items
  found in `criticalSlots` — the launcher can never take a critical hit in its own location, and
  "the ’Mech lost all its weapons" checks that walk critical slots will not see it.
* **Pinning test:** none. `tests/data/mechs.test.js` checks slot counts and ammo references, never
  that each listed weapon has at least one matching crit slot.
* **Recommended fix:** place the SRM-6 in a free critical slot (and rebalance the heat sinks) or
  remove it from `equipment.weapons`; add the reverse-integrity test described in D-01.

---

#### D-03 [consolidated → C-01] — the left and right hit-location columns are wrong (left is a copy of front; right is its mirror)

* **Severity:** high (data); live through side-arc attacks
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
  The columns are live: `AttackResolver.resolveAttack` calls
  `determineHitLocation(locRoll, this.getAttackDirection(attacker, target))` (`AttackResolver.js:357-360`),
  and `getAttackDirection` returns `'left'`/`'right'`/`'rear'` (`:458-471`), so every side-arc weapon
  attack already uses the wrong column. The direct `determineHitLocation(..., 'front')` calls in
  `GameEngine.js:834, 996, 1018, 1052` are fall/other paths, not the only consumers.
* **Pinning tests (assert the wrong data):** `tests/rules/combat/HitTables.test.js:74-107` (left) and
  `:110-143` (right) spell out the wrong rows as expectations; `:165-179` additionally asserts the two
  tables are mirror images, so fixing one side alone fails the suite. `:98-107` even derives a
  "balanced" probability of 14/36 from the wrong table.
* **Recommended fix:** replace both columns with the p139 rows (including 2 = own-side torso), and
  rewrite the HitTables tests to assert the manual rows rather than the data file's contents.

---

#### D-04 [consolidated → PHY-01] — punch and kick location tables are 2D6 tables with non-manual values (manual: 1D6, three columns)

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

#### D-05 — ammo `shots` is stored per ton while the crit table can hold several bins of the same id

* **Severity:** medium-high (ammo explosion damage and ammo expenditure)
* **File:line:** `src/data/mechs.json`:
  Atlas `srm6_ammo` occupies 2 crit slots (`:137`, `:142`) but the bin holds `shots: 15` (`:566`);
  Atlas `lrm20_ammo` 2 slots / `shots: 6` (`:571`); Thunderbolt `lrm15_ammo` 2 slots / `shots: 8`
  (`:2299`); Griffin `lrm10_ammo` 2 slots / `shots: 12` (`:4000`); Stalker `lrm10_ammo` 3 slots /
  `shots: 12` (`:5736`) and `srm6_ammo` 2 slots / `shots: 15` (`:5731`).
* **Manual (p52, AMMUNITION):** "All of the appropriate ammo type in a single critical slot explodes.
  If more than one critical hit slot holds the appropriate ammo type, the one with the most shots
  remaining explodes." And p96: "a critical hit to its ammunition bin deals the weapon’s damage
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

#### D-06 — MTF export writes `Heat Sinks:<total − crit sinks>`, so a round trip halves dissipation

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

#### D-07 — MTF exporter critical-slot padding: arms 10 lines (should be 12)

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

#### D-08 — MTF import silently drops cockpit, structure, armour and TSM/MASC header fields

* **Severity:** medium
* **File:line:** `src/import/mtfParser.js:309-323` (the returned object carries only config, chassis,
  model, mass, walkMP, jumpMP, engine, heatSinks, gyro, armor, weaponsList, criticalSlots,
  rawHeader).
* **Manual:** p44 (torso-mounted cockpit changes the head-destruction/crew outcome), p52 (MW heat
  damage "between 1 and 14 … 15 or higher") and p142 ("’Mech mounts small or torso-mounted cockpit
  +1"); p114 "Critical Hit: Slots allocated to armor are inapplicable slots"; p126 "Ferro-Fibrous —
  14" critical slots; p126 "Triple-Strength Myomer 0 6" (0 tons, 6 crits). The p115 Cockpit Systems
  body and the p47 cockpit-critical block are absent from the KB, so the specific Small/Torso-Mounted
  cockpit descriptions are unverified; the import still drops these fields, which is the finding.
* **Code behaviour:** a MTF containing `cockpit:Torso-Mounted Cockpit`, `Internal:Endo Steel`,
  `armor:Ferro-Fibrous`, `TSM:` or `MASC:` imports as a standard-cockpit, standard-structure,
  standard-armour ’Mech with no equipment flags. The repo's own fixture contains
  `cockpit:Standard cockpit`, `Myomer:Standard`, `Internal:Standard`
  (`tests/import/mtfParser.test.js:17, 20-21`) — all parsed into `rawHeader` and then discarded.
* **Pinning test:** none (no test asserts any of these fields survive).
* **Recommended fix:** parse and carry `Cockpit:`, `Internal:`/`Structure:`, `Armor:`, `TSM:`/`MASC:`
  and warn on unsupported combinations; assert round-trip preservation for at least cockpit type.

---

#### D-09 — rear-mounted weapons are detected only in the *name*, so `Medium Laser,CT (R)` imports with no location

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

#### D-10 — armour parser aborts on an unknown key (`RTL Armor:`) and loses rear torso armour

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

#### D-11 — Running MP is floored in the import path (manual: ×1.5 rounded **up**)

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

#### D-12 — MUL import fabricates a playable unit for unknown chassis (guessed MP, zero armour, no weapons)

* **Severity:** medium
* **File:line:** `src/import/mulParser.js:146-151` (`estimateWalkMP`: 6 / 5 / 4 / 3 by tonnage
  bracket) and `:157-186` (`buildStubMechDef`: every location `{front:0, rear:0}`, empty
  `criticalSlots`, `heatSinks 10`, `engine.rating = tonnage × estimated walk`).
* **Manual:** p6/p8 — a ’Mech's armour is a per-location set of circles on the record sheet, and
  p42/p44 damage resolution sends every point of damage to internal structure once armour is gone; a
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

#### D-13 — `terrain.json` disagrees with the manual's Movement Costs / PSR tables in five places

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

#### D-14 — `criticalHitTable` in `hitTables.json` is invented, contradicts p46, and is unused

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

#### D-15 — `physicalWeapons.json` omits Talons and Vibroblade

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

#### D-16 — `equipment.json` values with no BMM basis (or a shape the manual cannot express)

* **Severity:** low–medium, item by item
* **Manual quotes used below:** p50 Heat Point Table ("Jumping +1 per hex (min. of 3 per turn)");
  p14 ("Heat Generated: 1 heat point for every hex jumped … always generates a minimum of 3 heat
  points"); p126 (Jump Jet, Standard: tons `*`, 1 crit — "`*`This item’s tonnage and/or critical slot
  placement requires construction rules not covered in this book."; Targeting Computer `*` `*`;
  MASC `*` `*`; Heat Sink, Double 1 ton / 3 crits); p112 ECM Suites (disruption of Artemis / Narc /
  C3 / probes; the p112 body is absent from the KB, so this effect list is unverified); p26 GATOR
  (no ECM Target Number modifier listed); p116 MASC ("On a result of 2, the
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
  * `equipment.json:32-39` `ecm.toHitModifierEnemy: 1` — the p112 body is absent from the KB, so the ECM *effects* list (blocked Artemis,
    severed C3, dead Narc, hidden probes) is unverified; it is not a +1 TN, and p26's GATOR list has no ECM entry. (Overlaps
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

#### D-17 — Locust LCT-1V leg armour exceeds twice its internal structure

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

#### D-18 — MTF-derived unit ids never match roster ids

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

#### D-19 — fabricated/invented values in the import helpers

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

#### D-20 — `maps/urban.json` uses building terrain ids that `terrain.json` does not define

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

#### D-21 — maps store water hexes at level 0, so the water level-change cost can never be applied

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

### Verified correct against the manual
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

## 3.7 Engine infrastructure checked (no rules content)

- `src/engine/EventBus.js` — pub/sub listener registry and dispatch only; **checked, no BMM rules content, no finding**.
- `src/engine/StateManager.js` — state snapshots, history and serialisation only; **checked, no BMM rules content, no finding**.
- `src/rules/heat/HeatScale.js` — covered by the heat-scale threshold check in §3.4 (table + H-19); it has no separate findings row.

---

## 4. Cannot verify from the KB — assumptions vs citations

These rules could not be checked against the manual because the knowledge base has no chunk for the page body. They are grouped by domain with what the code currently assumes. **Nothing in this section is a manual citation.** Where a finding elsewhere depends on one of these, the finding says so. Where a rule is an outright code invention rather than an unverifiable reading, that is stated.

### 4.1 Movement, terrain and PSR (t1)

- **p61 — Terrain Modifications prose** (ice, mud, smoke, snow, swamp): no chunk. Only the p17/p136 cost rows and p142 PSR rows are quotable. The trigger conditions for ice/mud/deep-snow/swamp PSRs, and whether ice causes skidding, are unverified.
- **p51 — Effects of Heat: Movement:** body absent (p51 is missing; some spreads include the facing page, e.g. p17 in the p16 chunk). The Walk MP −3/−4/−5 steps at heat 15/20/25 and the +3/+4 TN values at 17/24 cannot be quoted. The p52 Hatamoto example confirms only the 5–9 (−1) and 10–14 (−2) bands. Tests lock the 5/10/15/20/25 ladder as code constants.
- **p57 — Falling Damage to a ’Mech / to a MechWarrior:** body absent. p58 and p74's worked examples were used instead; the exact per-level/rounding table is unquoted, so M-28's multiplier rests on the p74 example.
- **p15 — Ground Movement:** the 3+ level prohibition encoded at `MovementCalculator.js:52-54` is unverified; only the +1/+2 costs are quotable.
- **p71 — Collisions:** body absent. The collision damage formula at `SkiddingRules.js:57-68` has no citable manual value.
- **p67 — Moving Into Buildings:** entry procedure, failed-entry damage, involuntary entry, jumping into buildings, roof MP costs.
- **p117 — Triple-Strength Myomer:** the +2 walk MP / heat-9 threshold (`maxMP.js:51-52`, `equipment.json:62-63`) is unverified; only p38 (double damage) and p116 (TSM modifier before supercharger) are available.
- **p19 / p13 — Movement in Water / Movement Modes:** bodies absent. `run = 1.5 × walk` was inferred from p68's diagram (“Walking MP of 6 and a Running MP of 9”) and p52's example, not from a rule sentence. Treat M-13's ratio as strongly supported, not directly quoted.
- **p62 weather → MP wiring:** the weather values are in the KB, but `WeatherRules.js`'s MP hook is outside t1's file scope and was not audited.

### 4.2 Weapon attack, LOS, arcs and damage (t2)

- **p31 — Rolling to Hit:** only the table-of-contents entry is indexed. The `Math.max(2, tn)` floor (`AttackResolver.js:256`) and the “TN above 12 always misses” behaviour are unquoted.
- **p154 / p31 — Ammunition Expenditure:** wording unavailable.
- **p47 — Engine (Torso) / Cockpit (Head) critical effects** and engine explosion: only index entries; the p47 body is absent, so C-17's destruction consequences are partly unverified. **p48 and p96 are present** and supply the text previously attributed to p47: p48 has the GYRO and LEG/HEAD BLOWN OFF sentences, p96 the ammunition-bin damage sentence; the C-06, C-09 and D-05 citations have been re-paged accordingly.
- **p49 — Sensors (Head):** whether the +2 stacks per sensor slot.
- **p22–23 — LOS height test:** the exact sentence giving the “intervening terrain reaches the lower LOS level” threshold is not retrievable. The code's `Math.min(attackerLOS, targetLOS)` (`LineOfSight.js:100`) matches the standard reading but is not directly quoted.
- **p52/p27 — shutdown/immobile cross-reference:** p18's immobile definition was not retrieved.
- **p25 — Torso Twists body:** only p24's summary (arcs shift one hexside, facing unchanged) was retrieved — enough for ArcRules, not for the prone/extended-twist clauses.
- **p29 weather modifiers:** outside t2's files; not audited.
- Punch/kick table shape: t2 flagged OCR ambiguity between the KB's 2D6 data and the table; t3/t6 resolved it against p139/p140 (1D6), so it is **not** an open item.

### 4.3 Physical attacks and urban combat (t3)

- **p34–35 — Making a Physical Attack** (one physical attack per phase, multiple-target limits), **Different Levels prose**, the **comparative-modifier formula** (code uses `attacker.piloting − target.piloting`), and physical attacks against prone/immersed targets.
- **p37 — DFA damage** to target and attacker, location after DFA, attacker leg damage. The code's `floor(t/10) + floor(t/5)` / `floor(t/10)` (`PhysicalAttackResolver.js:400-403`) is an explicit guess and no test pins it.
- **p39–40 — Push Attacks** text (push TN, displacement, “one charge/DFA/push per target per turn”) and **Damage Resolution** for physical attacks. Whether charge/DFA use the Punch table is not stated in any available page; the code assumes Punch.
- **p67 — Moving Into Buildings:** exact MP wording, failed-entry damage (`tonnage/10` in code), involuntary entry, jumping into a building (p73 example implies a jump can only land on the roof), roof MP costs.
- **p71 — Attacking Buildings / Attacking ’Mechs Inside Buildings.**
- **p117 — TSM threshold.**
- **p57 — Falling-damage rule text;** p74's examples do confirm the formula/rounding the code uses (`tonnage/10 × (levels+1)`).
- **p109 — Vibroblade** activated damage and the retractable-blade/hand-actuator interaction.
- **p35 — charge/kick/push against a prone ’Mech at the same level:** the code rejects all three; only a test asserts it.
- **Charge-into-building** damage (“as though the ’Mech had charged the building”, p68) — the referenced rule on p35 is missing.

### 4.4 Heat, MechWarrior damage and phase sequence (t4)

- **p51 body** (Dissipating Heat / Recording Heat Build-Up / Effects of Heat — Movement): the Walk MP −3/−4/−5 values at 15/20/25, the +3/+4 TN values at 17/24 and the 6+/8+/10+ shutdown Avoid values at 18/22/26 cannot be quoted. Only the thresholds named on p52/p131 are available.
- **Whether heat reduces Run/Jump MP and how Run MP is recomputed** (p13/p51): the code subtracts the penalty from Run MP as well as Walk; the derivation is unverified, so **M-13 is medium, not high (review R-06)**.
- **p57 — Falling Damage to a MechWarrior.**
- **p53 / p55 — Making PSRs / PSR timing.**
- **p9 / p11 — Damaging a Warrior / Segmented Fire** (p58 duplicates p9; Segmented Fire is optional and not modelled).
- **p115 — Torso-Mounted Cockpit body;** its heat rule is quoted from p52 and its head-destruction rule from p44.
- **The printed Heat Scale's 29 row:** p8 describes the scale but does not print the ladder; cannot confirm the row (H-19).
- **“Depth 2+ fully submerged doubles every sink”:** this claim exists only in `RULES_AUDIT_REFERENCE.md`; p50 gives per-sink additional cooling (max 6). Treat it as unverified.

### 4.5 Battlefield layers (t5)

- **p77 — Artillery Support** body, Scatter Diagram and artillery TN modifiers: no chunk. The blast-ring reading of “3/1”, “4/2”, “5/3/1” (`BattlefieldSupport.js:62-73, 284-308`), the `SCATTER_DIRECTIONS` order and the p77 footnote are unverified.
- **p79 — Minefields** body: no chunk. Everything in `Minefields.js` beyond the p78 density rows — the 2D6 trigger vs density TN, the jump-only-landing trigger, the Kick-table hit locations, the one-grouping decrement, friendly fire, detection/clearing — is unverified.
- **p75 — Battlefield Support “Before Play Begins” / “During Game Play”:** only p147's BSP pool list is quotable. When support is announced/resolved and the exact one-time-use wording are unverified.
- **p63 — Wind, Wind Direction, Starting a Fire, Effects of Fire:** wind-direction determination and the ignition procedure are unverified. The fragment “Heavy and hardened buildings cannot catch fire in this fashion” has lost its antecedent (hence F-02 is reported as ambiguous, not as a certain error).
- **p61 — Terrain Modifications body:** smoke's attack/LOS modifiers and duration. The `turnsRemaining: 6` in `GameEngine.js:783` is uncited.
- **p89–95 — BattleMech Quirk Listing:** only a p94 fragment; the nine quirk costs/effects are verified via p145 + p86/p88, but per-chassis quirk assignments are unverified.
- **p143/144 — positive quirk table (correction):** not a gap — the KB contains it (id73), including Battle Computer, Command 'Mech and Improved Life Support; the earlier “mostly absent” note was wrong.
- **p60 — jungle terrain type:** p60 has JUNGLE, LIGHT/HEAVY rows (quoted by M-23/M-30); what is missing is the **p61 Terrain Modifications body**, and `terrain.json` has no jungle terrain type for the Fire Table row to use.

### 4.6 Data, import and export (t6)

- **SRM-2/4/6 launcher rows** (p121 chunk ends at “Medium Pulse Laser”; p122 resumes at “Pulse Weapons (continued)”). SRM damage/grouping/brackets were cross-checked through the p122 SRM-ammo rows.
- **Clan weapons** (p124–125, 127): only the Clan *equipment* table is present.
- **ECM suite tonnage/crits (Guardian):** rows absent from the equipment tables; `equipment.json.ecm.weight: 1.5` is unconfirmed.
- **MTF and MUL file grammars:** the BMM documents none of them. Findings D-06…D-10 are argued from the repo's own importer/exporter/fixtures and from record-sheet semantics, not from a manual quote.
- **Construction rules:** armour limits (2 × internal structure per location), internal-structure tables, engine rating = tonnage × Walk MP, minimum 10 heat sinks, jump-jet tonnage, maximum jump jets = Walk MP. These are marked “*” in p126/p127 as outside the book; D-17 is flagged against the p44 example only.
- **Individual ’Mech record sheets:** the BMM contains none; D-02/D-05/D-17 are internal-consistency findings.
- **Mapsheet layouts:** physical product; only grid size and terrain vocabulary are checkable.
- **`criticalHitTable` slot contents:** p46 gives the procedure and shape, not a general slot map.
- **p112 ECM Suites / p119 CASE II bodies:** only cross-references and index entries survive; the rules text on p112 and p119 is absent. D-16's p112 citation and C-14's p119 citation are marked unverified in place.

### 4.7 Code assumptions that are not citations

The following are explicit or de-facto assumptions in the code, listed so they are not mistaken for verified rules:

- Minefield hits on the **Kick Location Table** (`Minefields.js:133-138`) — p79 missing.
- Artillery **blast rings** `[3,1]` / `[5,3,1]` (`BattlefieldSupport.js:62-73`) — p77 missing.
- **Smoke duration 6 turns** (`GameEngine.js:783`) — p61 missing.
- **Fire damage 1D6** (`FireRules.js:104-107`) — contradicted by p50 (+5 heat), not merely unverified.
- **Collision damage** `floor(tonnage/10) × hexes` (`SkiddingRules.js:57-68`) — p71 missing.
- **DFA damage** `floor(t/10) + floor(t/5)` (`PhysicalAttackResolver.js:400-403`) — p37 missing.
- **Heat-scale 29 row** (`heatScale.json:21`) — p52 has no 29 step; duplicate of 26.
- **MUL walk MP by tonnage** and **zero-armour stubs** (`mulParser.js:146-186`) — no BMM rule derives MP from tonnage.
- **Building default levels 1/2/3/4** (`terrain.json:112-137`) — p66 says default unspecified buildings are medium, Level 2.
- **TSM heat-9 threshold** (`maxMP.js:51-52`, `equipment.json:62-63`) — p117 missing.
- **Pilot-hit “+1 TN per hit”** (`AttackResolver.js:150-154`) — no entry in the p28/p29 attack tables and no rule in p58.
- **“Rapid turn” skid trigger** (`SkiddingRules.js`/`PSRCalculator.js`) and **chain-skid extension** (`SkiddingRules.js:81-88`) — not in the manual; p68 says terrain *reduces* skid distance.
- **“Depth 2+ doubles every heat sink”** — only in `RULES_AUDIT_REFERENCE.md`, not in the KB.
- **`RULES_AUDIT_REFERENCE.md` itself must not be used as a source.** Its §4 reproduces the fabricated left/right/rear hit-location tables, §3 has the wrong heat TN thresholds and “sensors +1”, §5 calls the cluster table inaccurate (it matches p139), §6 says “Head → Center Torso (stops there)” against p44, and §9 reduces CASE to “location destroyed, no transfer” against p118. The t2 audit recommends deleting it or replacing it with KB-sourced quotes only.
- **Roadmap checkmarks are not evidence.** `docs/RULES_ROADMAP.md:14, 21, 145-146, 192-193, 200-202` marks the cluster/hit-location tables, the physical TN table, the Different Levels table, the hardened-building PSR and combat within buildings as complete; the audits found the hit tables, the level table, the hardened PSR and the building-level handling wrong (C-01, PHY-01, PHY-02, BLD-01, BLD-02). Do not cite roadmap ticks as compliance evidence.

---

## 5. Tests that pin the code instead of the manual

These tests currently lock in behaviour the audits found wrong. They must be rewritten with expectations taken from the manual page, not from the data file. Line references come from the audits; no test was run.

| Test (file:lines) | What it locks | Manual says |
|---|---|---|
| `tests/rules/combat/HitTables.test.js:74-143, 165-179` | left/right side columns as copies/mirrors of front, plus a “mirror symmetry” rule | p139: Left Side 3 = Left Leg, 8 = Center Torso, 2 = Left Torso; the columns are not mirrors of front |
| `tests/rules/combat/PhysicalAttackResolver.test.js:41-71` | `EXPECTED_PUNCH/KICK` copied from `hitTables.json` (self-referential) | p140/p139: 1D6 punch and kick tables with direction columns |
| `tests/rules/movement/MovementCalculator.test.js:108-118, 132-136` | depth-1 = 2, depth-2 = 3, swamp = 3 | p17/p136 + p128: 3 / 6 from Level 0; swamp is a +1 modification |
| `tests/ui/MovementPreview.test.js:565-603` | same water/swamp values, with the calculator mocked | as above; these tests keep passing after a fix |
| `tests/rules/movement/MovementCalculator.test.js:173-177, 214-218` | downhill costs nothing / any magnitude | p17: +1 per level down (1–2 levels) |
| `:185-189` | pavement overrides level climb to 1 | p20: level-change costs are still required |
| `:485-490, 570-613` | run MP not doubled by MASC; failure damages one actuator | p116: run at double walk MP; one critical hit to each leg |
| `:636-659, 661-665, 696-722` | heat bands, “run reduced by same penalty”, TSM +2 at heat 9 | p51/p117 missing (unverified constants); the run-MP recompute is unverified (§4.4) |
| `tests/rules/movement/SkiddingRules.test.js:291-316, 334-343` | floor(tonnage/10) × hexes; zero remaining MP → no skid | p68: ceil(hexes moved / 2); half fall damage + fall, rounded up |
| `:460-608`; `:111-183` | chain-skid extension; skid on any pavement run + “rapid turn” | no such rules; skid requires a facing change on pavement |
| `:205-281` | skid direction = current facing | p68: direction before the facing change |
| `tests/rules/movement/PSRCalculator.test.js:357-366` | heavy woods +2 | p60: woods = no PSR; only jungle is +1/+2 |
| `:152-159` | depth-0 water trigger at 0 | p60: depth 0 water = no PSR |
| `:377-424` | “Large Level Drop”, “Jumped Into Woods”, “Rapid Turn” triggers | not in the manual |
| `:598-605` | passes a 4th `makePSR` argument the method ignores (vacuous) | PSRs should carry movement context (p54/p68) |
| `:636-713`; `:608-634` | fall damage × levels, stub `locations`; unconditional pilot hit per fall | p74: × (levels + 1); p56: Facing After Fall; p58: PSR first, hit only on failure |
| `tests/rules/combat/DamageResolver.test.js:182-189` | `next()` constant 0.5 for the crit roll | p46: 1D6 block then 1D6 slot |
| `tests/rules/combat/DamageResolver.test.js:209-215` | side-torso transfer map points at the arm (latent; the live path is masked) | p44: transfer to the center torso |
| `tests/integration/equipment.test.js:33-51, 118-138` | CASE destroys the location and wipes armour | p118: internal structure only; excess ignored; arm remains |
| `tests/rules/combat/AttackResolver.test.js:370-379` | “pilot hits: +1 TN” | no such entry in p28/p29 or p58 |
| `tests/rules/combat/PhysicalCombat.test.js:52-62, 124-129` | inverted kick/punch level table; 7-weapon list | p140: punch +1 level only, kick −1 only; p38: nine weapon rows |
| `tests/rules/urban/Buildings.test.js:44-47, 147-153` | hardened building entry PSR = 3 | p54/p142/p143: +5 |
| `tests/integration/urban.test.js:141-161, 184-199` | basement fall for light/no-basement cases | p66: fall only when tonnage > CF at phase start |
| `tests/rules/heat/HeatManager.test.js:111-121`; `tests/integration/heatScale.test.js:452-462` | +1 per leg sink, no cap | p50: +1 single / +2 double, max 6 |
| `tests/rules/heat/HeatManager.test.js:145-202` | restates `heatScale.json` row-for-row, including heat 29 | p52: no 29 step |
| `tests/engine/phaseSystem.test.js:472-613, 619-690` + `phaseStateMachine:415-590` + `fullTurn:200-298` | consciousness in End Phase, flat 8+ restart | p58/p12: consciousness after attacks; p52: restart in Heat Phase, auto below 14 |
| `tests/integration/phaseStateMachine.test.js:138-147` + `gameEngineFlow:295-301` + `twoMechCombat:82` | physical attack winner-first | p12: loser declares first |
| `tests/integration/gameEngineFlow.test.js:271-293` + `fullTurn:110-141` + `phaseStateMachine:102-136` | initiative winner may choose to go first | p10: the loser must act first |
| `tests/engine/determinism.test.js:56-64` | lowest-player-id tie fallback | p10: re-roll all ties |
| `tests/integration/heatScale.test.js:56-78, 178-192`; `HeatManager.test.js:278-330` | heat ammo explosion only zeroes `shots` | p52: resolve the explosion (shots × damage) |
| `tests/rules/terrain/FireRules.test.js:22-27, 47` | heavy/hardened buildings cannot burn | p64 Fire Table includes heavy +0 / hardened +1 |
| `tests/integration/battlefield.test.js:126-134` | 1D6 fire damage | p50: burning hex = +5 heat |
| `tests/rules/battlefield/Minefields.test.js:73-99` | kick-table mine hits and one-grouping decrement | p79 missing (unverified assumption) |
| `tests/rules/battlefield/Support.test.js:36-39, 188-204` | artillery ring split `[3,1]`/`[5,3,1]` | p77 missing (unverified) |
| `tests/rules/quirks/Quirks.test.js:58-66` | every quirk is negative with cost > 0 | p82–86: positive quirks exist (Fine Manipulators cost 0) |
| `tests/engine/sync.test.js:60`; `:200-264` | smoke `{level:'light', turnsRemaining:6}`; total strike secrecy | p61 missing; p76 requires public announcement of offensive aerospace support |
| `tests/import/mtfParser.test.js:342` | imported run MP = 4 for walk 3 | p48: round up → 5 |
| `tests/import/mulParser.test.js:401-411` | walk MP by tonnage bracket, 0 armour | no BMM rule derives MP from tonnage |
| `tests/maps/Mapsheets.test.js:9-13, 62-69` | terrain ids absent from `terrain.json`; forbids negative hex levels | p22: water is negative height (Depth 2 = Level −2) |

**Withdrawn from this list in review R-01:** `MovementCalculator.test.js:324-332` asserts the correct shortest-turn cost (`min(diff, 6 - diff)`) and is not a code/manual mismatch.

**The right pattern to copy:** `tests/import/mtfParser.test.js:415-429` (per-slot ammo arithmetic derived from shots-per-ton) and `tests/data/mechs.test.js:213-218` (`run === ceil(walk × 1.5)` from p48). Both assert a manual rule rather than a data constant.

## Appendix A — KB page bodies present and citation audit

**KB page bodies present** (derived from the 76 `Battletech` chunks returned by `kb_list` for `battlemechmanual.pdf`; page numbers are taken from the chunk texts, including facing pages such as p17, p29, p73, p95, p121, p137, p140, p144 and p147):

> p3–p4 (TOC/credits), p6, p8, p10, p12, p14, p16–p18, p20, p22, p24, p26, p28–p30, p32, p36, p38, p42, p44, p46, p48, p50, p52, p54, p56, p58, p60, p62, p64, p66, p68, p70, p72–p74, p76, p78, p80, p82, p84, p86, p88, p94–p96, p98–p100, p102, p104, p106, p108, p110, p114, p116, p118, p120–p122, p126–p128, p130–p147.

Pages not listed have no body chunk in the KB. (p31 is a table-of-contents fragment only; p137, p140 and p144 are present inside the p136/p139/p143 chunks, not as separate `kb_list` entries.)

**Citation audit (mechanical).** A regex scan (`p<number>` / `p. <number>`) over §1–§5 (excluding this appendix's page list) found **819 page tokens covering 106 distinct pages**:

- **68 distinct pages / 671 tokens** match the present list.
- **38 distinct pages / 148 tokens** cite absent pages.

Every absent-page reference that remains is deliberate and non-quotational:

| Reason | Pages |
|---|---|
| Listed as absent/unverified in the §3/§4 inventories; no rule quote depends on them | p9, p11, p13, p15, p19, p25, p34, p35, p37, p39, p40, p47, p49, p51, p55, p59, p61, p63, p67, p71, p75, p79, p89, p109, p117, p154 |
| Cross-reference inside a quoted manual sentence (“see p. N”); no text is quoted from the target page | p27, p45, p53, p57, p107 |
| Marked index-only/unverified in the finding itself | p31 (C-09), p77 (H-05), p112 (D-16), p115 (D-08), p119 (C-14) |
| Non-BMM provenance | p270 (a `RULES_ROADMAP.md` line number, not a BMM page) |
| Clan-weapons gap (p124–p125 range) | p124 |

No finding now attributes a rule quote to an absent page. Where the source text could be located it was re-paged (C-06, D-02, D-05, C-09, C-14, D-08, D-12, PHY-03, PHY-13, PHY-14, H-08, D-16); where it could not, the claim is marked unverified in place.

---

*End of report. Finding text is reproduced from the six read-only audits; no new finding or citation was added during consolidation. Where an audit's own tally and its finding list disagreed (t5), the counted list was used and the discrepancy is recorded in §1. Review rounds 1–2 corrected severities, withdrawals, page citations and coverage; review round 3 added the definitive KB page list and the mechanical citation audit in Appendix A. The corrected active totals remain 8 blockers / 39 high / 72 medium / 43 low = 162.*

---

## Remediation log (phases B-C)

**Compiled by:** fix-data (t15), 2026-10-29, from the verifier's read-only draft (t9) plus the review-round-1 repairs (t12-t14) and this bookkeeping pass (t15).
**Method:** full suite plus independent Node ESM probes of the shipped rules code against the KB page text. A fix is counted only where the probe reproduces the quoted page value; passing tests alone were not accepted as evidence.
**KB pages used:** p6, p10, p12, p20, p32, p42, p44, p46, p48, p50, p52, p54/p142, p56/p57, p58, p72, p74, p96, p116, p118, p121, p136, p139/p140, p143.

### Verification runs

| Command | Exit | Result |
|---|---:|---|
| `npx vitest run --configLoader runner --pool=threads` (shim form) | 0 | 57 files / 1957 tests passed, 1.45 s (state after the review-round-1 repairs) |
| `... tests/integration/heatScale.test.js tests/rules/heat/HeatManager.test.js tests/data/mechs.test.js` | 0 | 337 tests passed (R-07 heat-scale data change) |
| coverage run | - | not re-run after the repairs; the only artifact in the tree is the pre-verification `coverage/clover.xml`: statements/lines 9244/9869 = 93.66 %, branches 2364/2781 = 85.01 %, functions 454/496 = 91.53 %. That is above the configured 90/83/86/90 floors but stale. |

### Findings addressed (verified by probe, not by the test suite)

| Finding | KB | Evidence |
|---|---|---|
| C-01 | p139 | `hitTables.left/front/right` match p139 row-for-row (33/33 roll x column pairs); roll 2 carries the through-armour critical flag in all three columns; `determineHitLocation()` returns the same rows. |
| C-02 | p139, p44, p42 | `rear` = the front locations with `isRear: true` only on CT/LT/RT; a rear hit on a left torso consumes rear armour, and a rear hit on an arm consumes front armour (no armour bypass). |
| C-03 | p32, p96 | `buildDamageGroupings`: LRM-20 with 12 hits = `[5,5,2]`; LRM-10 with 7 = `[5,2]`; SRM-6 = six 2-point groups; MRM-20 = `[5,4]`; ATM-9 = `[5,1]`; AC/20 = `[20]`. One hit-location roll per grouping. |
| C-05 | p44 | `getTransferLocation`: side torso to centre torso, head/CT nowhere; the old side-torso-to-arm map is gone. |
| C-06 | p46/p143 | Critical bands: 2-7 none, 8-9 one, 10-11 two, 12 blown-off head or limb (torso: three criticals). |
| C-07 | p46 | Block and slot selection: an all-inapplicable block is skipped, inapplicable slots re-roll both dice, and further crits on a multi-slot component soak. See R-05 for the double-heat-sink case. |
| C-08 | p32/p139 | A hit-location roll of 2 makes the through-armour critical roll at resolution (probe: AC/20, TAC roll 8, normal 20 damage still to armour); `_applyDamageTo` does not re-roll it. |
| C-14, C-15 | p118, p44, p102 | CASE: internal structure only, excess ignored, arm blown off without stripping its armour; without CASE the explosion transfers inward past armour; pilot takes 2. |
| C-16 | p42 | A hit that destroys the location passes `explosiveOnly`; non-explosive crits are returned as discarded. |
| PHY-01 | p139/p140 | Punch/kick are 1D6 direction-column tables; the resolver uses `roll1d6` (2D6 only for physical weapons on the standard p139 table and for to-hit). |
| PHY-02 | p140 | Kick rejected one level up, punch rejected one level down; forced tables are the manual's way round (punch at +1 uses the Kick table, kick at -1 uses the Punch table). |
| M-01 | p136/p128 | Depth 1 from Level 0 = 3 MP; Depth 2 = 6 MP; Depth2 to Depth2 = 4 MP; Depth 3 is priced on the Depth 2+ row. |
| M-02 | p136 | Level change up or down: +1 MP per level; 3+ levels is illegal in both directions. |
| M-03 | p20 | Pavement = base 1 MP, preserving level-change, ice/mud/deep-snow and weather costs. |
| M-07 | p44 | One leg destroyed gives walking 1 / running 0; the jump rating is untouched. |
| M-08 | p48 | One hip gives walk 2 / run 3; two hips give 0/0; run is always `ceil(1.5 x walk)`. |
| M-09 | p116 | MASC active leaves walk unchanged and gives run = 2 x walk. Activation is still dead (M-19). |
| M-20 | p54/p142 | Damaged gyro/hip are standing modifiers, not extra walking triggers; the run/jump causes were added; a destroyed leg gives +5 and replaces that leg's actuator modifiers. |
| M-21 | p52 | Shutdown auto-fails other PSRs (999) but the involuntary-shutdown PSR rolls at piloting +3. |
| M-22 | p58/p143/p74 | Fall: prone set, Facing After Fall from 1D6, warrior's PSR before damage with the causing modifiers, pilot damage only on failure; damage is `ceil(tonnage/10) x (levels + 1)` in 5-point groups. The same-level levels bug is fixed by R-01; rear-facing armour by R-02. |
| BLD-01 | p54/p142/p143 | `terrain.json` hardened PSR = 5, `entryPSRModifier('hardened')` = 5, Buildings tests and `RULES_ROADMAP.md` updated. |
| BLD-03 | p72 | Phase-start CF snapshot: snapshot 38 with live CF 19 gives reduction 4 (not 2); CF damage is banked and charged at phase end; the urban test reproduces the manual's five-hit 38 to 19 example. |
| H-04 | p58/p12 | Consciousness rolls happen when damage lands; the End Phase is recovery-only. |
| H-05 | p44/p58 | Cockpit critical kills the pilot, head destruction kills the pilot, the sixth hit goes through one kill path, and the unit is removed on the next phase transition. |
| H-06 (action guard) | p52/p58 | Shutdown/unconscious units are rejected by `validateAction`, `_handleMove` and `_handleFire`; the slot is consumed with `pass`. Immobile 0 MP remains missing (see below). |
| H-07 | p52 | Restart in the Heat Phase: heat below 14 auto-restarts, 14-29 rolls 2D6 against the current Avoid target, 30+ is blocked as overflow. Since R-03 a 'Mech that shuts down in this phase waits for a later Heat Phase. |
| H-10 | p10/p12 | The physical attack queue starts with the initiative loser. |
| H-14 | p10/p131 | Destroyed units are filtered from `buildUnitQueue` and removed at the phase transition. |
| H-15 | p52/p54 | The involuntary-shutdown PSR is piloting +3 (not auto-failed); a failed roll goes through `applyFall`. |
| F-01 / H-03 (fire half) | p50 | Fire heat is live: +5 standing, +2 per burning hex moved through; outside heat (fire + plasma) is capped at 15 and applied before dissipation; armour is unchanged; `fireDamageRoll` and `GameEngine.resolveFireDamage` are gone. |
| D-01 | p121 | `small_laser` added with the p121 stats (heat 1, damage 3, 0/1/2/3, 0.5 t, 1 crit); every roster weapon id resolves; data-integrity test added. |
| D-02 | p6/p96 | The Atlas SRM-6 occupies leftTorso slots 8-9; the reverse-integrity test asserts every mounted weapon has a critical slot. |
| D-07 | p6 | Atlas export lines: head 6, CT/LT/RT/LA/RA 12, legs 6 (arms were 10). |

### Review-round-1 repairs (t12-t14)

| Repair | KB | Fix and probe evidence |
|---|---|---|
| R-01 | p57/p143 | A same-level fall was passed to `resolveFall` as levelsFallen 1, doubling every flat fall. `GameEngine._handleMove` now starts at 0 and uses only the real start-to-end drop. Probes: 65 t flat fall 7 damage `[5,2]` (was 14); 100 t flat fall 10 `[5,5]` (the pinned test was corrected from 20); 100 t one-level drop 20 `[5,5,5,5]`. Fixed by t12. |
| R-02 | p56/p57 | The Facing-After-Fall "Rear" result applied damage with `isRear=false`. `GameEngine.applyFall` now forwards the hit-location entry's `isRear`. Probe: facing roll 4 gives the rear column; rear centre torso 14 to 4, front centre torso 47 unchanged. Fixed by t12. |
| R-03 | p52 | A 'Mech that shut down during a Heat Phase could restart in the same phase. `_enterHeatPhase` now passes the pre-phase `wasShutdown` map and `_resolveRestartAttempts` skips 'Mechs that were not already shut down. Probe: 0 `unitRestarted` events while shutdown stays true even though the roll would beat the target; the next Heat Phase restarts (roll 12 vs 4+). Fixed by t12. |
| R-04 | p46 | Sensor slots were merged into one soakable component. Each sensor slot is now its own critical target, per the p46 engine/gyro/sensors exception. Fixed by t13. |
| R-05 | p46 | A 3-slot double heat sink scored one destroyed sink per critical. The first critical now disables the sink and later slots soak the hit. Fixed by t13. |
| R-06 | p44 | Both legs destroyed gave 1 walking MP and was treated as a destruction. `maxMP` now returns 0 walk/run/jump and marks nothing destroyed (t14); `Unit.isDestroyed()` no longer applies a both-legs clause, and the board-survival / 0 MP regression test is in place (t17). Fixed by t14 and t17. |
| R-07 | p50/p52 | `src/data/heatScale.json` cited the deleted `RULES_AUDIT_REFERENCE.md`; its `source` now reads "BattleMech Manual p50 heat scale rows; effects and avoid targets per p52". Fixed by t15. |
| R-08 | - | This section is the remediation log required by review round 1. Fixed by t15. |

### Partially fixed or not addressed

| Finding | Status | Evidence |
|---|---|---|
| H-01 (blocker) | **not addressed - Phase A (dead wiring), out of scope** | Walking one hex leaves `unit.heat = 0`; `HeatManager.calculateHeatGeneration` still has no production caller. p50 walking/running/jumping heat is still absent in play. |
| C-04 (high) | not addressed | `unit._damageThisPhase` still has no writer anywhere in `src/`; the 20+ damage PSR cannot fire. |
| M-19 / M-09 activation (high) | not addressed | `activateMASC`/`rollMASC` still have no caller; a MASC failure still destroys one actuator in the first leg found (p116: one critical hit to each surviving leg); `deactivateMASC` still resets the turn counter. |
| M-31 (medium) | not addressed | Swamp is still 3 MP; p136 prices swamp as a +1 terrain modification (2 MP over clear). |
| M-10 / M-11 (high) | not addressed | Jump movement is still neighbour BFS: pays facing per hop, blocked by occupied hexes, no height check, start hex at 0 MP. |
| H-18 (medium) | not addressed | General unconscious-PSR auto-fail is missing; a probe with `pilot.conscious=false` still returns a normal target, not 999. Consciousness-before-PSR ordering exists only in the heat/shutdown path. |
| H-06 remainder (high) | partial | Immobile units are blocked from acting, but 0 MP for immobile 'Mechs is not implemented (shutdown walk/run = 3/5, unconscious = 3/5). |
| H-02, H-08, H-09 (high/medium) | not addressed | Engine-critical heat still lives only in the dead generator; a heat-induced ammo explosion still only zeroes the bin and adds 2 pilot damage (no shots x damage explosion); water cooling is still +1 per leg sink (no single/double distinction, no 6-point cap). |
| H-11, H-12, H-19 (medium/low) | not addressed | `initiativeWinnerGoesFirst` house rule still exists (default false); the queue is still fixed 1:1 for unequal forces; `heatScale.json` still has the heat-29 row. |
| C-09 (high) | not addressed | Fire still uses a caller-supplied weapon; no mounted/destroyed-weapon, one-attack-per-weapon-per-turn, or ammo-bin validation. |
| C-17 (medium) | partial | The cockpit critical now kills the pilot; the engine 3rd hit is still only an effect string (`unit.destroyed` not set) and a destroyed gyro auto-fails PSRs but does not set `unit.prone`. |
| M-25 / M-23 / M-24 (medium) | partial (dead code remains) | `PSRCalculator` still contains the fabricated "Large Level Drop", "Rapid Turn (Running)" and "Jumped Into Woods" triggers and woods-as-jungle modifiers (+1/+2). `GameEngine._move` hardcodes their flags false, so they are unreachable; sand is still absent and depth-0 water still pushes an "Entered Water: 0" trigger when called directly. |
| BLD-02 (high) | not addressed | `buildingCombat` still counts building hexes only, never levels; a roof occupant still counts as "inside". |
| D-05 (medium) | not addressed | Eight roster 'Mechs have more than one crit slot for a single ammo entry (e.g. Atlas `lrm20_ammo` x2 slots with `shots: 6`); an explosion zeroes the shared bin for all slots. |
| D-06 (high per t6 tally) | not addressed | The Atlas export writes `Heat Sinks:10 Single` from `count:20`; reimport gives 10, i.e. dissipation is halved (probe). |
| Phase A dead wiring | **not addressed, out of scope by design** | `HeatManager.calculateHeatGeneration`, `activateMASC`, `rollMASC` and `skiddingRules` still have no production caller. |
| D-08...D-21, C-10...C-13, C-18...C-27, PHY-03+, BAS/**, S-**, W-**, Q-**, hidden-'Mech items | outside this run | Not touched by phases B-C; still open per the sweep sections above. |

### Regression spot-checks (nothing found broken)

- Full suite green for the other rules areas: urban 15 tests, minefields 13 + 15, quirks 14 + 42, hidden units 12 + 7, sync/replay/wire/serialization/determinism 8/2/3/8/7.
- Source-diff review: only rule modules, their data and their tests changed. `Quirks.js`, `WeatherRules.js`, `visibility.js`, `StateManager.js` and `HexMath.js` are untouched; no test outside the rewrite list was altered to hide a behaviour change.
- Urban: tests were strengthened (the new p72 five-hit example asserts start-of-phase CF 38 to 19 at phase end), not weakened.
- Minefields: the 2D6 to 1D6 Kick-table change follows from PHY-01; the hit-location choice remains explicitly labelled an unverified p79 assumption (no p79 body in the KB), and the tests assert all six 1D6 rows.
- Export/import: 12 arm slots round-trip; the pre-existing heat-sink header defect (D-06) is not introduced by this work but is still present.
- Wire/sync/replay: no non-transferable values were added to new payloads (suite green); `unitRemoved` is emitted at removal instead of `unitDestroyed` for a pilot-only death - a semantic caveat, not a projection failure.

### Residual risks

1. Coverage was not re-measured after the repairs; the 93.66 % / 85.01 % / 91.53 % figures are the pre-verification artifact.
2. The green suite includes tests rewritten in phase D; every audited value was re-derived from the KB text, but the dead-but-present PSR triggers (M-23/M-24/M-25) remain a gap a future test could mask.
3. H-01 (movement heat) is a top-tier blocker still absent from play and is the main rules-visible gap left by this run.
4. Jump-fall damage levels: `GameEngine._handleMove` charges the start-to-end level drop for an ordinary missed-PSR fall, including jumps. p56 reads that falls are 0-level unless the 'Mech is displaced downwards 2+ levels and explicitly includes 'Mechs that fall due to jumping, so a 35 t Jenner failing its landing PSR after jumping Level 2 to Level 0 should take 4 damage (0 levels), while the code gives 12 (2 levels). The one-level-drop test added in this run rests on p57, whose body is absent from the KB, so this needs a manual check before either value is treated as settled. Logged by review round 2, not fixed.
