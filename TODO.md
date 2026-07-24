# TODO

## Completed ✅

- [x] Phase system with per-unit alternation
- [x] Initiative winner choice
- [x] Full heat scale (20+ thresholds from BMM)
- [x] Escalating shutdown and ammo explosion rolls
- [x] Target movement modifier (hexesMoved tracking)
- [x] Minimum range formula fix
- [x] Partial cover (+1 penalty)
- [x] Targeting Computer (DB/DE/P weapons)
- [x] Hit location tables (left/right side fixed)
- [x] Cluster hit table (canonical BMM values)
- [x] Kick location table (all legs)
- [x] Punch location table (correct distribution)
- [x] DFA formula (piloting + mods)
- [x] Facing change costs in pathfinding
- [x] PSR gyro modifier (+3)
- [x] Overheating PSR trigger
- [x] Fall damage multiplied by levels fallen
- [x] MASC failure scaling (consecutive turns)
- [x] TSM bonus (+2 walk MP)
- [x] Skidding collision damage formula
- [x] Chain-skidding on ice/pavement
- [x] UI panel cleanup between phases
- [x] Confirm/Cancel move buttons wired
- [x] Movement preview overlay
- [x] Heat bar rendering
- [x] Armor bar max values (per-location)
- [x] Active player indicator
- [x] Consciousness checks in End phase
- [x] Shutdown restart checks in End phase
- [x] Auto-resolve heat phase
- [x] Dice roller re-seeding each turn
- [x] 459 tests passing

## High Priority

- [ ] Multiplayer support (WebSocket/WebRTC)
- [ ] AI opponent
- [ ] Save/load game state
- [ ] Sound effects and music
- [ ] Mobile-responsive layout

## Medium Priority

- [ ] Additional Mech variants (Clan tech, Inner Sphere variants)
- [ ] Hidden units (double-blind rules)
- [ ] Minefields
- [ ] Artillery support
- [ ] Weather effects
- [ ] Building collapse rules
- [ ] Forced withdrawal rules
- [ ] Design quirks
- [ ] Water depth 3+ impassable to non-naval units
- [ ] Floating criticals (reroll location on ammo crit)
- [ ] LB-X autocannon cluster support
- [ ] Pulse laser -2 to-hit modifier
- [ ] Water partial cover (depth 1)

## Low Priority

- [ ] Campaign mode
- [ ] Unit customization editor
- [ ] Replay system
- [ ] Chat system for multiplayer
- [ ] Spectator mode
- [ ] Map editor
- [ ] Custom scenarios
- [ ] Right-click context menu
- [ ] Previous unit shortcut (Shift+N)
- [ ] Dice log trimming for long sessions

## Known Issues

- [ ] 'n' key doesn't wrap around to first unit
- [ ] Initiative roll results not displayed to user
- [ ] Two separate code paths for weapon fire (main.js + UIController)
- [ ] Double-rendering on some actions (mitigated by rAF coalescing)

## Technical Debt

- [ ] Add TypeScript for better type safety
- [ ] Consolidate selection tracking (mapRenderer.selectedUnit vs ui.selectedUnitId)
- [ ] Add proper error handling and validation
- [ ] Optimize Canvas rendering (dirty rect tracking)
- [ ] Add end-to-end tests
- [ ] Set up CI/CD pipeline
- [ ] Add ESLint/Prettier configuration
- [ ] Remove inline physical attack tables (use JSON exclusively)

## Documentation

- [ ] Add JSDoc comments to all public APIs
- [ ] Create developer guide
- [ ] Add inline code comments for complex algorithms
- [ ] Create video tutorial
- [ ] Add rules reference guide
