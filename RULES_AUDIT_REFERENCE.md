# BattleMech Manual - Key Rules Audit Reference

Extracted from battlemechmanual.pdf (7th printing) and cross-referenced with project source code.

---

## 1. MOVEMENT RULES

### Movement Modes

| Mode | MP Available | Attacker Mod | Heat Generated |
|------|-------------|-------------|----------------|
| Stationary | 0 | 0 | 0 |
| Walk | Walking MP | +1 | 1 |
| Run | Walk × 1.5 (round up) | +2 | 2 |
| Jump | Jump MP | +3 | 1/hex (min 3) |
| Sprint (Opt.) | Walk × 2 | +2 (also +1 TMM) | Run heat × 1.5 |

### MP Costs by Terrain Type

| Terrain | MP Cost | Notes |
|---------|---------|-------|
| Clear | 1 | Default |
| Pavement/Road | 1 | Overrides underlying terrain |
| Light Woods | 2 | +1 to-hit for target in it; +1 intervening woods |
| Heavy Woods | 3 | +2 to-hit for target in it; +2 intervening woods |
| Water Depth 1 | 2 | Standing only; provides partial cover |
| Water Depth 2 | 3 | Cannot run into; submerged |
| Rough | 2 | |
| Rubble | 2 | Triggers PSR (0 modifier) |
| Swamp | 3 | +1 PSR modifier |
| Bridge | 1 | |

### Terrain Modifications (additive +1 MP each)

| Modifier | Effect |
|----------|--------|
| Ice | +1 MP; PSR +4; risk of skidding |
| Mud | +1 MP; PSR +1 |
| Deep Snow | +1 MP; PSR +1 |

### Level Changes

- Maximum level change: 2 levels up or down per hex
- Cannot enter a hex 3+ levels higher than current hex
- Cost: +1 MP per level up
- Moving down: +0 MP per level
- Drop of 3+ levels in one move: triggers PSR
- Backward movement: cannot change levels

### Facing Changes

- Cost: 1 MP per hexside turned
- Example: 180-degree turn (3 hexsides) = 3 MP
- Torso twist: twist ±1 hexside in Weapon Attack Phase (shifts weapon arcs only, not facing)
- Torso twist does NOT change attack direction against the twisting 'Mech

### Running-Specific Rules

- Cannot move backward while running
- Running on pavement/ice: risk of skidding (triggers PSR)
- Rapid turn (2+ hexsides) while running: triggers skidding check

### Jumping

- Ignores terrain MP costs (always 1 MP per hex)
- Cannot jump if prone at start of turn
- Generates 1 heat per hex jumped (minimum 3 total)
- Attacker modifier: +3
- Target modifier: +1 additional (on top of TMM based on hexes moved)
- Lost 1 Jump MP per destroyed jump jet

### Minimum Movement Rule

- A 'Mech that intends to use Minimum Movement must run
- Allows movement of at least 1 hex even if MP penalties would prevent it

### MASC (Myomer Acceleration Signal Circuitry)

- Activation: declare before movement, roll 2D6
  - Turn 1: fail on 2 (3+ to succeed)
  - Turn 2 (consecutive): fail on 4 or less (5+)
  - Turn 3: fail on 6 or less (7+)
  - Turn 4: fail on 10 or less (11+)
  - Turn 5+: auto-fail
- Each unused turn reduces threshold by one interval (min 3+)
- Success: Running MP = Walk × 2
- Failure: 1 critical hit to each leg (no roll on Determining Critical Hits)
- MASC replaces normal Running MP (does not stack additively with other bonuses for calculation purposes)

### TSM Movement Effect

- At 9+ heat: +1 Walk MP (code implements as +1)
- PDF says: +2 Walk MP at 9+ heat (TSM increases Walking MP by 2)
- **NOTE: Discrepancy between PDF (+2 Walk MP) and project equipment.json (+1 walkMPBonus)**

### Heat-Based MP Reduction

| Heat Range | MP Reduction |
|------------|-------------|
| 0-4 | 0 |
| 5-9 | -1 Walk MP |
| 10-14 | -2 Walk MP |
| 15-19 | -3 Walk MP |
| 20-24 | -4 Walk MP |
| 25+ | -5 Walk MP |

---

## 2. PILOTING SKILL ROLLS (PSR)

### PSR Mechanics

- Base TN = Pilot's Piloting Skill
- Roll 2D6 >= modified TN to pass
- Failure = fall (unless otherwise specified)
- Multiple PSRs at same time: roll one at a time, modifiers cumulative
- If one PSR fails, remaining PSRs for the SAME TRIGGER are ignored
- Quad 'Mechs: -2 to all PSRs to avoid falls (with all 4 legs intact)
- Immobile/unconscious 'Mechs: auto-fail all PSRs

### Complete PSR Triggers & Modifiers

**Damage to 'Mech:**
| Trigger | Modifier |
|---------|----------|
| 20+ damage in one phase | +1 |
| Leg/foot actuator destroyed | +1 each |
| Hip actuator destroyed | +2 (replaces other actuator mods) |
| Gyro hit | +3 |
| Gyro destroyed | Auto-fall |
| Leg destroyed | Auto-fall (+5 for MechWarrior damage avoidance) |
| Involuntary reactor shutdown | +3 |

**Physical Attacks Against 'Mech:**
| Trigger | Modifier |
|---------|----------|
| Was kicked | 0 |
| Was pushed | 0 |
| Was successfully charged / hit by DFA | +2 |

**'Mech's Own Actions:**
| Trigger | Modifier |
|---------|----------|
| Missed kick | 0 |
| Made successful charge | +2 |
| Made successful DFA (successful) | +4 |
| Made unsuccessful DFA | Auto-fall |
| Entered Depth 1 water | -1 |
| Entered Depth 2 water | 0 |
| Entered Depth 3+ water | +1 |
| Attempted to stand | 0 |
| Entered sand hex | +1 |
| Entered light jungle hex | +1 |
| Entered heavy jungle hex | +2 |
| Entered rubble hex | 0 |
| Running with damaged hip or gyro | per Preexisting Damage |

**Skidding (by hexes moved):**
| Hexes Moved | Modifier |
|-------------|----------|
| 0-2 | -1 |
| 3-4 | 0 |
| 5-7 | +1 |
| 8-10 | +2 |
| 11-17 | +4 |
| 18-24 | +5 |
| 25+ | +6 |

**Building Entry:**
| Building Type | Modifier |
|---------------|----------|
| Light | 0 |
| Medium | +1 |
| Heavy | +2 |
| Hardened | +5 |

**Preexisting Damage (cumulative):**
| Damage | Modifier |
|--------|----------|
| Per leg/foot actuator previously destroyed | +1 |
| Per hip actuator previously destroyed | +2 |
| Gyro previously hit | +3 |
| Leg previously destroyed | +5 |

**Special Cases (apply to all PSRs):**
| Case | Modifier |
|------|----------|
| Four-legged 'Mech (all legs) | -2 |
| Unintentional charge | +3 |
| AES in legs | -2 |
| Hardened Armor | +1 |
| Small/torso-mounted cockpit | +1 |
| Terrain: Ice | +4 |
| Terrain: Mud | +1 |
| Terrain: Deep Snow | +1 |
| Terrain: Swamp | +1 |

**Project Implementation (PSRCalculator.js) checks:**
- Heavy Woods entry
- Rubble entry
- Large level drop (3+)
- Skidding
- Rapid turn while running
- Damaged leg actuators (modifier = count of destroyed leg actuators)
- Jumped into woods
- Entered water
- Standing up
- 20+ damage received in phase
- Gyro damage (1 hit: PSR required; 2+ hits: auto-fail)
- Hip actuator damage (+2)
- Missing leg (+5)

### Falling

- Unit becomes prone
- 1 pilot hit (unconscious at 6 hits)
- Fall damage = `ceil(tonnage / 10)` points, applied to legs

---

## 3. G.A.T.O.R. - COMPLETE ATTACK MODIFIERS

### Base TN = Gunner's Gunnery Skill

### G - Gunnery (Base)

Starting TN = attacker's Gunnery skill (typically 4 for regular pilots)

### A - Attacker Movement Modifier

| Movement | Modifier |
|----------|----------|
| Stationary | 0 |
| Walk | +1 |
| Run | +2 |
| Jump | +3 |
| Sprint (optional) | +2 |

### T - Target Movement Modifier (TMM)

Based on **hexes actually moved** (not MP spent):

| Hexes Moved | TMM |
|-------------|-----|
| 0-2 | 0 |
| 3-4 | +1 |
| 5-6 | +2 |
| 7-9 | +3 |
| 10-17 | +4 |
| 18-24 | +5 |
| 25+ | +6 |

Additional: Jumping gives +1 on top of hex-count TMM.

### T - Target Terrain Modifier

| Terrain | Modifier |
|---------|----------|
| Target in light woods/jungle | +1 |
| Target in heavy woods/jungle | +2 |
| Partial cover | +1 (leg hits→cover instead) |

### O - Other Modifiers

| Modifier | Value |
|----------|-------|
| **Intervening Woods** | +1 per light woods hex, +2 per heavy woods hex |
| **Attacker Heat** | 0-4: 0, 5-9: +1, 10-14: +2, 15-19: +3, 20+: +4 |
| **Pilot Hits** | +1 per hit |
| **Target Immobile (prone/shutdown)** | -4 |
| **Targeting Computer** (DB, DE, P weapons) | -1 |
| **Minimum Range** | `minRange - distance + 1` |
| **Sensors destroyed** | +1 |

### R - Range Modifier

| Range Bracket | Modifier |
|---------------|----------|
| Short | 0 |
| Medium | +2 |
| Long | +4 |
| Minimum range penalty | `minRange - distance + 1` |

**Weapon Range Brackets Reference:**

| Weapon | Min | Short | Medium | Long | Heat | Damage |
|--------|-----|-------|--------|------|------|--------|
| Medium Laser | 0 | 1-3 | 4-6 | 7-9 | 3 | 5 |
| Large Laser | 0 | 1-5 | 6-10 | 11-15 | 8 | 8 |
| PPC | 3 | 4-6 | 7-12 | 13-18 | 10 | 10 |
| AC/2 | 4 | 5-8 | 9-16 | 17-24 | 1 | 2 |
| AC/5 | 3 | 4-6 | 7-12 | 13-18 | 1 | 5 |
| AC/10 | 0 | 1-5 | 6-10 | 11-15 | 3 | 10 |
| AC/20 | 0 | 1-3 | 4-6 | 7-9 | 7 | 20 |
| SRM-2/4/6 | 0 | 1-3 | 4-6 | 7-9 | 2/3/4 | 2/missile |
| LRM-5/10/15/20 | 6 | 7 | 8-14 | 15-21 | 2/4/5/6 | 1/missile |
| Machine Gun | 0 | 1 | 2 | 3 | 0 | 2 |
| Flamer | 0 | 1 | 2 | 3 | 3 | 2 |

---

## 4. HIT LOCATION TABLES (2D6)

### Front/Rear Hit Location (Biped)

| Roll | Location | Notes |
|------|----------|-------|
| 2 | Center Torso | Possible through-armor critical |
| 3 | Right Arm | |
| 4 | Right Arm | |
| 5 | Right Leg | |
| 6 | Right Torso | |
| 7 | Center Torso | |
| 8 | Left Torso | |
| 9 | Left Leg | |
| 10 | Left Arm | |
| 11 | Left Arm | |
| 12 | Head | |

### Left Side Hit Location

| Roll | Location |
|------|----------|
| 2 | Center Torso (critical) |
| 3 | Right Arm |
| 4 | Right Arm |
| 5 | Right Leg |
| 6 | Right Torso |
| 7 | Center Torso |
| 8 | Left Torso |
| 9 | Left Leg |
| 10 | Left Arm |
| 11 | Left Arm |
| 12 | Head |

### Right Side Hit Location

| Roll | Location |
|------|----------|
| 2 | Center Torso (critical) |
| 3 | Left Arm |
| 4 | Left Arm |
| 5 | Left Leg |
| 6 | Left Torso |
| 7 | Center Torso |
| 8 | Right Torso |
| 9 | Right Leg |
| 10 | Right Arm |
| 11 | Right Arm |
| 12 | Head |

### Rear Hit Location

| Roll | Location | Note |
|------|----------|------|
| 2 | Center Torso | critical, rear |
| 3 | Left Arm | rear |
| 4 | Left Torso | rear |
| 5 | Left Leg | rear |
| 6 | Center Torso | rear |
| 7 | Center Torso | rear |
| 8 | Right Torso | rear |
| 9 | Right Leg | rear |
| 10 | Right Arm | rear |
| 11 | Right Arm | rear |
| 12 | Head | rear |

### Punch Location Table

| Roll | Location |
|------|----------|
| 2 | Head |
| 3 | Head |
| 4 | Center Torso |
| 5 | Right Torso |
| 6 | Left Torso |
| 7 | Center Torso |
| 8 | Left Arm |
| 9 | Right Arm |
| 10 | Left Torso |
| 11 | Right Torso |
| 12 | Head |

### Kick Location Table

| Roll | Location |
|------|----------|
| 2 | Head (PDF: left torso; **note** project code says leftTorso on 2) |
| 3-4 | Right Leg (PDF) / Right Torso(2), Right Leg(3-4) (code: rightTorso on 3) |
| 5-6 | Left Leg (PDF) |
| 7-8 | Right Leg (PDF) |
| 9-10 | Left Leg (PDF) |
| 11 | Right Leg (PDF) |
| 12 | Left Leg (PDF) |

**Project Code kick table:**
- 2: leftTorso, 3: rightTorso, 4-6: leftLeg, 7-9: rightLeg, 10-11: leftLeg, 12: leftLeg

**DISCREPANCY: Project kick table differs from BattleMech Manual PDF standard kick table.** Standard kick table is weighted heavily toward legs (rolls 3-12 all on legs, weighted by side).

---

## 5. CLUSTER HITS TABLE

### Missile Hit Resolution (2D6 Roll → Number of Missiles That Hit)

| Roll | 2 | 3 | 4 | 5 | 6 | 7 | 9 | 10 | 12 | 15 | 20 | 30 | 40 |
|------|---|---|---|---|---|---|---|----|----|----|----|----|----|----|----|
| 2 | 1 | 1 | 1 | 1 | 2 | 2 | 3 | 3 | 4 | 5 | 6 | 10 | 12 |
| 3 | 1 | 1 | 2 | 2 | 2 | 2 | 3 | 3 | 4 | 5 | 6 | 10 | 12 |
| 4 | 1 | 1 | 2 | 2 | 3 | 3 | 4 | 4 | 5 | 6 | 9 | 12 | 18 |
| 5 | 1 | 2 | 2 | 3 | 3 | 4 | 5 | 6 | 8 | 9 | 12 | 18 | 24 |
| 6 | 1 | 2 | 2 | 3 | 4 | 4 | 5 | 6 | 8 | 9 | 12 | 18 | 24 |
| 7 | 1 | 2 | 3 | 3 | 4 | 4 | 5 | 6 | 8 | 9 | 12 | 18 | 24 |
| 8 | 2 | 2 | 3 | 3 | 4 | 4 | 5 | 6 | 8 | 9 | 12 | 18 | 24 |
| 9 | 2 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 10 | 12 | 16 | 24 | 32 |
| 10 | 2 | 3 | 3 | 4 | 5 | 6 | 7 | 8 | 10 | 12 | 16 | 24 | 32 |
| 11 | 2 | 3 | 4 | 5 | 6 | 7 | 9 | 10 | 12 | 15 | 20 | 30 | 40 |
| 12 | 2 | 3 | 4 | 5 | 6 | 7 | 9 | 10 | 12 | 15 | 20 | 30 | 40 |

**DISCREPANCY: Project cluster table differs significantly from the PDF table.** The PDF table includes columns for sizes 7, 9, 12 which are not in the project code. The values also differ for many entries. The project's clusterTable in hitTables.json is simplified and inaccurate.

**Standard Cluster Table (PDF) - reproduced above is correct.**

For each grouping (5 damage for LRMs, 2 damage for SRMs), roll a separate hit location.

---

## 6. DAMAGE RESOLUTION

### Damage Resolution Flow

1. **Check armor** on hit location/facing → mark off circles
2. **If armor depleted** → remaining damage goes to Internal Structure
3. **Internal Structure hit** → roll for critical hit (8+ on 2D6)
4. **If internal structure reaches 0** → location destroyed
5. **Excess damage after destruction** → transfers inward per Damage Transfer Diagram
6. **Ammo explosion damage** → bypasses armor, goes directly to internal

### Damage Transfer Diagram

```
Left Arm    → Left Torso    → Center Torso (head/CT don't transfer)
Right Arm   → Right Torso   → Center Torso
Left Leg    → Left Torso    → Center Torso
Right Leg   → Right Torso   → Center Torso
Head        → Center Torso  (stops there)
(If transfer location is also destroyed, goes to Center Torso)
```

### Location Destruction Effects

| Location | Effect |
|----------|--------|
| **Head** | MechWarrior killed, 'Mech destroyed |
| **Center Torso** | 'Mech destroyed |
| **Left/Right Arm** | Weapons in arm lost; can't punch with that arm |
| **Left/Right Leg** | 'Mech falls; Walk MP reduced to 1; can't run; +5 PSR modifier |
| **Left/Right Torso** | Corresponding arm also destroyed |

### Through-Armor Critical Hit

- **Roll of 2 on hit location** → possible critical hit even through intact armor
- Roll on Determining Critical Hits Table (8+ on 2D6 = crit)

### Critical Hit Effects

| Item Hit | Effect |
|----------|--------|
| Ammo bin | Explosion! Damage = remaining shots × weapon damage |
| Engine (1st hit) | +5 heat/turn |
| Engine (2nd hit) | +10 heat/turn total |
| Engine (3rd hit) | Engine destroyed → 'Mech disabled |
| Gyro (1st hit) | PSR required; +3 modifier |
| Gyro (2nd hit) | Gyro destroyed → auto-fall |
| Cockpit | Pilot killed |
| Sensors | +1 TN to all attacks |
| Life Support | Life support destroyed |
| Heat Sink | -1 dissipation |
| Jump Jet | -1 Jump MP |
| Actuators | Various TN/PSR penalties |

### Ammo Explosion Resolution

1. Damage = remaining shots × weapon damage per shot
2. Bypasses armor → applied directly to internal structure
3. CASE in the same location: explosion contained to that location (location destroyed, no transfer)
4. CASE II: only 1 point of internal damage + remove armor from location/rear; roll 2D6 again for each crit (8+ ignores it)
5. No CASE: full internal damage, then transfers inward to next location's internal structure

### Project Implementation Notes

- DamageResolver.js: `applyDamage()` handles armor → internal → crit → location destruction
- Critical hit requires 8+ on 2D6 (correct per rules)
- Single critical check per internal hit (rules say one check per internal structure hit that penetrates)
- Ammo explosion damage = `ammo.shots * weaponDamagePerShot` (correct)
- CASE check: looks for `case` item in same location's criticalSlots (correct)
- Engine: 3rd hit disables (correct; rules say "destroyed")
- Gyro: 2nd hit = auto-fall (correct)

---

## 7. HEAT EFFECTS

### Heat Scale (from PDF Record Sheet)

| Heat | Effect |
|------|--------|
| 0-4 | No effect |
| 5-7 | -1 Walk MP |
| 8-9 | -1 Walk MP; +1 TN to fire |
| 10-12 | -2 Walk MP |
| 13 | -2 Walk MP; +2 TN to fire |
| 14 | -2 Walk MP; Shutdown avoid on 4+ |
| 15-16 | -3 Walk MP |
| 17 | -3 Walk MP; +3 TN to fire |
| 18 | -3 Walk MP; Shutdown avoid on 6+ |
| 19 | -3 Walk MP; Ammo explosion avoid on 4+ |
| 20-21 | -4 Walk MP |
| 22 | -4 Walk MP; Shutdown avoid on 8+ |
| 23 | -4 Walk MP; Ammo explosion avoid on 6+ |
| 24 | -4 Walk MP; +4 TN to fire |
| 25 | -5 Walk MP |
| 26 | -5 Walk MP; Shutdown avoid on 10+ |
| 27 | -5 Walk MP; +4 TN to fire |
| 28 | -5 Walk MP; Ammo explosion avoid on 8+ |
| 29 | -5 Walk MP; Shutdown avoid on 10+ |
| 30 | Shutdown (automatic at end of turn) |

### Simplified Heat Effect Groups (Project Implementation)

| Heat Range | TN Modifier | MP Reduction | Shutdown | Ammo Explosion |
|------------|------------|-------------|----------|---------------|
| 0-4 | 0 | 0 | No | No |
| 5-9 | +1 | -1 Walk MP | No | No |
| 10-14 | +2 | -2 Walk MP | No | No |
| 15-19 | +3 | -3 Walk MP | No | No |
| 20-23 | +4 | -3 Walk MP | 4+ avoid | No |
| 24+ | +4 | -3 Walk MP | 4+ avoid | 8+ = explosion |

**Project HeatManager.js heat ranges differ from the official Heat Scale on the record sheet.** The official scale has more granular thresholds (steps at 5, 8, 10, 13, 14, 15, 17, 18, 19, 20, 22, 23, 24, 25, 26, 27, 28, 29, 30). The project simplifies to 0-4, 5-9, 10-14, 15-19, 20-23, 24+.

### Heat Generation Sources

| Activity | Heat |
|----------|------|
| Walking | +1/turn |
| Running | +2/turn |
| Jumping | +1 per hex (min 3) |
| Standing up attempt | +1 |
| Weapons fire | Per weapons table |
| 1st engine crit | +5/turn |
| 2nd engine crit | +10/turn total |
| External heat (fire, plasma, etc.) | max 15/turn |

### Heat Dissipation

- **Single heat sink**: 1 heat/turn
- **Double heat sink (IS)**: 2 heat/turn
- **Water (Depth 1, standing)**: leg-mounted sinks doubled (max +6 additional dissipation)
- **Water (Depth 2+, fully submerged)**: all sinks doubled (max +6 additional dissipation)
- **Deep Snow**: +1 dissipation if at least one leg sink (prone: +3)

### Shutdown Check

- At 20+ heat: roll 2D6; 4+ avoids shutdown
- At higher heat (from record sheet): target number increases (6+, 8+, 10+)
- **Project code**: always uses target 4 for shutdown (simplified)

### Ammo Explosion Check

- At heat 19+: roll 2D6; 4+ avoids ammo explosion (per record sheet)
- At heat 23+: avoid on 6+
- At heat 28+: avoid on 8+
- **Project code**: only checks ammo explosion at heat 24+, with target 8+ (simplified)

### TSM Activation

- Heat >= 9: TSM active
- +1 Walk MP (project code) / +2 Walk MP (PDF)
- 2× physical attack damage (punch/kick/club)

---

## 8. PHYSICAL ATTACKS

### Base TN = Attacker's Piloting Skill

### Attack Type Modifiers Table

| Attack Type | Modifier | Damage Formula | Hit Table |
|-------------|----------|---------------|-----------|
| Punch | +0 | `floor(tonnage / 10)` | Punch table |
| Kick | -2 | `floor(tonnage / 5)` | Kick table |
| Charge | +0 | `floor(attackerTonnage / 10) × hexes charged` | Punch table |
| DFA | +0 (+ pilots base TN) | Punch: `floor(tonnage / 10)` + Kick: `floor(tonnage / 5)` | Both tables |
| Push | -1 | 0 (displacement) | N/A |
| Club | -1 | Based on weight of "club" limb | Punch table |

### Additional Modifiers

- Target movement modifier: added (same as weapon attack TMM)
- Attacker movement modifier: added
- Gyro damage: +1 per hit
- Heat modifiers do NOT apply to physical attacks
- Sensor modifiers do NOT apply to physical attacks

### Punch

- Requires at least 1 functioning arm
- Cannot punch if prone
- Missing one arm: +1 TN
- Damage = `floor(attacker tonnage / 10)`
- Can punch with 1 or 2 arms (two separate attack rolls if both arms)

### Kick

- Requires at least 1 functioning leg
- Cannot kick if prone
- Missing one leg: +2 TN
- Damage = `floor(attacker tonnage / 5)`
- **If kick misses: attacker must make PSR (0 modifier) or fall**

### Charge

- Attacker moves to target hex (must be adjacent at end)
- Damage to target = `floor(attacker tonnage / 10) × hexes charged` (not MP, hexes actually moved)
- Damage to attacker = `floor(target tonnage / 10)`
- Both damages divided into 5-point groupings; roll hit location per grouping
- After successful charge: attacker makes PSR (+2 modifier) or falls
- Comparative modifier: subtract target's Piloting from attacker's Piloting; add result to TN

### Death From Above (DFA)

- Requires Jump MP > 0
- Cannot DFA if prone
- TN = Piloting + 4 (inherent difficulty)
- On hit: target takes punch damage + kick damage; attacker takes `floor(attacker tonnage / 10)` leg damage
- On miss: attacker auto-falls and takes `floor(attacker tonnage / 5)` damage
- Attacker always goes prone after DFA
- Comparative modifier applies
- Ignores terrain modifiers

### Push

- Target must be adjacent
- On success: target must make PSR or be displaced 1 hex in attack direction
- A 'Mech can only be the target of one charge, DFA, or push per turn

### Project Implementation Notes

- PhysicalAttackResolver.js: punch damage = `floor(tonnage / 10)` ✓
- Kick damage = `floor(tonnage / 5)` ✓
- Charge damage = `floor(tonnage / 10) * distanceCharged` ✓
- DFA TN = `piloting + 4` ✓ (PDF says DFA base modifier is +0, plus comparative modifier)
- **NOTE: DFA TN calculation simplified in code vs. full rules**

---

## 9. EQUIPMENT

### CASE (Cellular Ammunition Storage Equipment)

- **Location**: Side torso only (per project)
- **Weight**: 0.5 tons
- **Effect**: When ammo explodes in CASE-equipped location:
  - Internal structure in that location takes damage as normal
  - **Excess damage is ignored** (does NOT transfer inward)
  - Corresponding arm still falls off if side torso destroyed
  - Critical hits to CASE slots = no effect (reroll)

### CASE II

- Same as CASE plus:
  - Only 1 point of internal structure damage from ammo explosion
  - Remaining damage applied to location's rear armor (or half starting armor for limbs, whichever is less)
  - Critical hits from ammo explosion: roll 2D6 again; on 8+ the crit is ignored
  - Head Rule: 1 point internal damage + half starting head armor destroyed (round up)

### Guardian ECM Suite

- **Weight**: 1.5 tons (IS); 1.0 ton (Clan)
- **Range**: 6-hex bubble
- **Effects on enemy within bubble**:
  - Active Probes blocked
  - Artemis IV/V FCS blocked (lose TN and cluster bonuses)
  - C3/C3i networks cut off
  - Narc beacons non-functional
- **Project implementation**: +1 to-hit modifier for enemies within 6 hexes (simplified)

### Targeting Computer

- **Weight**: `tonnage / 10` rounded up per weapon tonnage affected
- **Modifier**: -1 TN for DB (Direct-Fire Ballistic), DE (Direct-Fire Energy), and P (Pulse) weapons
- **Aimed Shots**:
  - Mobile target: +3 TN (no head shots), TC -1 modifier does not apply
  - Immobile target, head: +3 TN, no TC modifier
  - Immobile target, non-head: -5 TN (-4 immobile, -1 TC)
- **Exclusions**: Flamers, Machine Guns, Cluster weapons, Flak weapons not eligible
  - Exception: HAG (Hyper-Assault Gauss) applies -1 TN if not making Flak attack
- **Pulse weapons**: cannot make aimed shots against mobile targets; never apply TC modifier for aimed shots
- **Project**: only applies -1 TN for DE weapons (simplified from DB, DE, P types)

### MASC (Myomer Acceleration Signal Circuitry)

- **Weight**: varies by engine rating and tonnage
- **Effect**: Activates before movement; on roll of 3+, Walking MP × 2 for running
- **Failure (roll of 2)**: 1 critical hit to each leg (auto, no Determining Critical Hits roll)
- **Consecutive Turn Penalty**:

| Consecutive Turn | Fail On |
|-----------------|---------|
| 1st | 2 |
| 2nd | 4 or less |
| 3rd | 6 or less |
| 4th | 10 or less |
| 5th+ | Auto-fail |

- Each unused turn reduces threshold by one interval (never below 3)
- MASC + Supercharger: Running MP = Walk × 2.5; separate activation rolls for both

### TSM (Triple-Strength Myomer)

- **Heat Threshold**: 9+ heat at end of turn for next-turn activation
- **Effects** (when active):
  - **Walk MP bonus**: +2 (PDF) / +1 (project code) — **DISCREPANCY**
  - **Physical damage**: 2× for punch, kick, club attacks
  - **Lifting ability**: doubled
- 6 critical slots (weight-free)
- Critical hits to TSM slots = no effect

---

## KEY DISCREPANCIES FOUND (Project vs. PDF)

| # | Area | Project | BattleMech Manual PDF |
|---|------|---------|----------------------|
| 1 | **TSM Walk MP bonus** | +1 Walk MP | +2 Walk MP |
| 2 | **Heat scale** | Simplified 5-threshold system (0-4, 5-9, 10-14, 15-19, 20-23, 24+) | 20+ specific thresholds with different shutdown/ammo targets per level |
| 3 | **Cluster Hit Table** | Simplified/incomplete table (only sizes 2,3,4,5,6,7,10,15,20,30,40) | Standard table includes size 9 and 12; values differ |
| 4 | **Kick location table** | Includes torso hits on rolls 2-3 | Standard table: torso on 2, then all leg hits (3-4 right leg, 5-6 left leg, 7-8 right leg, 9-10 left leg, 11 right leg, 12 left leg) |
| 5 | **Shutdown target** | Always 4+ | Varies by heat: 4+ at 14, 6+ at 18, 8+ at 22, 10+ at 26 |
| 6 | **Ammo explosion check** | Only at 24+, target 8+ | Multiple thresholds: 4+ at 19, 6+ at 23, 8+ at 28 |
| 7 | **Targeting Computer** | Only for DE type weapons | DE, DB, and P type weapons |
| 8 | **DFA TN calculation** | `piloting + 4` (simplified) | Piloting base + comparative modifier + all standard modifiers |
| 9 | **MASC failure model** | Fixed target 3; leg actuator damage | Consecutive-turn scaling; each leg takes auto crit |
| 10 | **ECM effect** | +1 TN to enemies in range | Disrupts C3/Artemis/Narc/Probes; no direct TN modifier |

---

*Extracted from BattleMech Manual v1.2 (7th printing, corrected), published 2017/2023 by Catalyst Game Labs. Cross-referenced with project source code at `src/rules/` and `src/data/`.*
