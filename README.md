# BattleTech Tabletop Simulator

A web-based implementation of the Classic BattleTech tabletop wargame, faithfully recreating the core rules from the *BattleMech Manual* and *Total Warfare*.

## Features

- **Complete Rules Engine** - Movement, combat (GATOR), heat management, physical attacks, damage resolution
- **Hex Grid System** - Flat-top hex grid with proper coordinate math and line-of-sight calculations
- **14 BattleMechs** - 12 canon designs (Atlas AS7-D through Awesome AWS-8Q) plus two equipment refits
- **17 Weapons** - Medium Laser, PPC, AC/2-20, SRM-2/4/6, LRM-5/10/15/20, and more
- **Equipment System** - CASE, ECM, Targeting Computer, MASC, TSM wired into the rules
- **Canvas Rendering** - 2D hex map with terrain visualization, unit tokens, and movement previews
- **Phase System** - Initiative, Movement, Weapon Attack, Physical Attack, Heat, End phases
- **1,669 Tests** - Comprehensive test suite covering all rules modules

## Quick Start

```bash
# Clone the repository
git clone https://github.com/IchBinButter/Javascript-Battletech.git
cd Javascript-Battletech

# Install dependencies
npm install

# Start the development server
npm run dev
```

Open http://localhost:3000 in your browser.

## Controls

| Action | Control |
|--------|---------|
| Select unit | Click on a friendly Mech |
| Move unit | Click on an empty hex (movement phase) |
| Target enemy | Click on an enemy Mech |
| Pan map | Arrow keys |
| Next unit | `N` key |
| Deselect | `Escape` key |
| Toggle grid | `G` key |

## Game Flow

1. **Initiative Phase** - Click "Roll Initiative" to determine move order
2. **Movement Phase** - Select units and click hexes to move them
3. **Weapon Attack Phase** - Select weapons, target enemies, click "Fire Selected"
4. **Physical Attack Phase** - Select attack type, target enemy, click "Execute Attack"
5. **Heat Phase** - Click "Resolve Heat" to apply heat effects
6. **End Phase** - Click "Next Turn" to advance

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with coverage (fails if coverage drops below the floor)
npm run test:coverage
```

Coverage is measured with the V8 provider over `src/**` (data JSON excluded). The
thresholds in `vitest.config.js` are a regression floor, not a target: they sit a few
points below the measured values so a drop fails the run while ordinary refactoring does
not. A HTML report is written to `coverage/`.

## Architecture

```
src/
├── data/           # JSON data files (mechs, weapons, equipment, terrain, hit tables)
├── engine/         # Game engine (GameEngine, PhaseManager, StateManager, EventBus)
├── hex/            # Hex grid system (HexMath, HexGrid, HexRenderer)
├── models/         # Data models (Unit, GameState, Hex, Weapon)
├── renderer/       # Canvas map renderer
├── rules/          # Rules engine
│   ├── combat/     # Attack resolution, damage, line-of-sight
│   ├── heat/       # Heat management
│   └── movement/   # Movement, PSR, skidding, facing
├── ui/             # UI controller
└── utils/          # Utilities (dice, helpers)
```

## Rules Implemented

### Movement
- Walk, Run, Jump movement modes
- Terrain costs (woods, water, rough, rubble, swamp)
- Level changes and elevation
- Facing changes and torso twist
- Piloting Skill Rolls (PSR)
- Skidding mechanics

### Combat (G.A.T.O.R.)
- **G**unnery skill base
- **A**ttacker movement modifier (+0/+1/+2/+3)
- **T**arget movement/terrain modifier
- **O**ther modifiers (heat, pilot hits, woods)
- **R**ange modifier (short/medium/long)
- Cluster hit tables for missiles
- Hit location tables (front/side/rear)

### Damage
- Armor → Internal Structure → Critical Hits
- Location destruction and damage transfer
- Ammo explosions and CASE containment
- Engine hits (2+ = shutdown)
- Gyro hits (2+ = auto-fall)

### Heat
- Heat generation from weapons and movement
- Heat dissipation (10 single or 5 double sinks)
- Heat level effects (TN penalties, MP reduction)
- Shutdown and ammo explosion checks
- Water interaction (double leg sink dissipation)

### Physical Attacks
- Punch (1 damage per 10 tons)
- Kick (1 damage per 5 tons)
- Charge (movement-based damage)
- Death From Above (jump attack)
- Push (displacement)

### Equipment
- **CASE** - Contains ammo explosions to equipped location
- **ECM** - +1 to-hit for enemies within 6 hexes
- **Targeting Computer** - -1 to-hit for direct-fire energy weapons
- **MASC** - Doubles walk MP with failure risk
- **TSM** - +1 walk MP and 2x physical damage at 9+ heat

## Data-Driven Design

All unit stats, weapons, and equipment are defined in JSON files:

- `src/data/mechs.json` - Mech configurations
- `src/data/weapons.json` - Weapon definitions
- `src/data/equipment.json` - Equipment stats
- `src/data/terrain.json` - Terrain types and costs
- `src/data/hitTables.json` - Hit location and cluster tables

Adding new units is as simple as adding entries to the JSON files.

## Tech Stack

- **Frontend**: Vanilla JavaScript (ES modules), HTML5 Canvas, CSS3
- **Testing**: Vitest
- **No build step** - Runs directly in the browser with ES modules

## License

MIT
