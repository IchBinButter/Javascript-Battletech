# Design Principles

This document records the conventions this project follows so that rules, data, tests and
process stay consistent as the roster and the engine grow. It is meant to be read before
adding a rule, a 'Mech or a data format.

Companion documents: `docs/RULES_ROADMAP.md` (what is planned) and
`docs/RULES_COMPLIANCE_SWEEP.md` (what is currently wrong, with evidence).

---

## 1. Scope

**Rules.** The BattleTech Manual (BMM) is the rules authority. BattleMechs only: no
vehicles, infantry, aerospace or DropShips in play, and no Battlefield Support beyond what
is already implemented.

**Era.** The medium-term roster target is **3025-era Inner Sphere** BattleMechs. Clan
technology, Star League-era equipment and later-era designs are out of scope until they are
explicitly scheduled, because each brings construction rules (XL/endo/ferro, turrets,
advanced armour) the simulator does not model.

**Canon only.** The project models **canonical designs only**:

- **No custom variants** — no notable-pilot 'Mechs, no Solaris VII one-offs, no
  "what if" refits.
- **No apocryphal variants** — nothing that exists only in a video game, novel or other
  non-tabletop source.
- A variant enters the roster when an official tabletop publication (TRO/record sheet)
  defines it. Reference wikis such as Sarna are useful for orientation and for finding
  which variants exist, but they are **not** authoritative for values; the record sheet is.

**Reference data.** The knowledge base (the BMM page text) is the source of truth for
rules. When a page body is unavailable, the rule is marked *unverifiable* rather than
guessed; speculative implementations are labelled as assumptions in code and tests.

---

## 2. Rules fidelity

1. **The manual wins.** If code and manual disagree, the manual is right and the test is
   wrong. Fix both together.
2. **Quote the page.** Rules code and tests cite the manual page; a test named after a rule
   must actually exercise that rule.
3. **Every rule must be reachable in play.** A rule that only exists in a module the engine
   never calls is not implemented. It counts as done only when a normal player action can
   trigger it, and there is a test that goes through the engine (`processAction`), not just
   the module.
4. **Tests assert manual values, not code output.** Never derive the expected value from
   the implementation (no copying the JSON into the test as "the table"). A test that
   passes because it mirrors the code protects nothing.
5. **Derived values are computed, not stored.** Internal structure follows tonnage (p44),
   movement follows engine rating (p48), movement costs follow `terrain.json`. Storing a
   second copy of a derived quantity creates drift.
6. **One table, one reader.** Tables live in JSON data with a single module that reads
   them. Do not keep a second hand-written copy in code.

---

## 3. Data model

**Runtime is flat.** The engine, importer, exporter, force builder and tests all consume a
flat `mechDef` — one complete entry per variant. `src/data/mechs.json` holds that array.

**Source is layered (before bulk import).** Authoring will split into a chassis layer and a
variant layer, compiled to the flat runtime file:

```
data/chassis/<chassis>.json   tonnage, internal structure source, quirks, tech base
data/variants/<chassis>.json  engine, gyro, armor, heat sinks, critical slots, equipment
        │  build step (merge + derive)
        ▼
src/data/mechs.json           flat, one entry per variant   ← unchanged contract
```

Rules for that split:

- **Chassis-level:** tonnage, internal structure (derived from tonnage), design quirks,
  chassis name/family, tech base.
- **Variant-level:** engine type and rating, gyro, armour type and points, heat sinks,
  critical slots, equipment and ammunition, plus any quirk override.
- A variant may change almost anything mechanical (a later Atlas variant uses endo steel and
  an XL engine, which changes its entire crit layout), so the chassis layer must not be
  treated as a set of fixed mechanics. Only the fields above are inherited.
- **Movement and MP are derived** from engine rating and tonnage; they are not authored.

**Roster freeze.** No new 'Mechs are added until the chassis/variant restructure is
complete. The next import waits for it.

**Canonical data conventions.**

- `id` is lowercase kebab: chassis + model (`atlas-as7d`).
- Critical slots: 12 in arms and torsos, 6 in head and legs (p6).
- Ammunition: **one bin per critical slot**, keyed `type_ammo`, `type_ammo#2`, …
- Quirks: chassis-level by default, with an explicit per-variant override list.

---

## 4. Engine and state

- **Determinism.** Seeded dice (`gameId + turn`), no `Math.random()` or `Date.now()` in
  rules; unit ids come from a sequence.
- **Serializable state.** Everything in `GameState`/`Unit` round-trips through
  `toJSON`/`fromJSON`, including Sets. Events crossing the wire are plain data
  (`toTransferable`).
- **Per-player projection.** Hidden information is filtered at the projection boundary
  (`projectStateForPlayer`); nothing renders or patches from the raw state when a viewer
  matters.
- **Commands, not mutations.** The UI sends actions through `processAction`; it does not
  edit units or state directly.
- **Stateless rules modules** where practical: rules take `(unit, state, dice)`, return
  data, and let the engine apply it inside `applyStateChange` so history and diffs see it.
- **Debug logs.** While the app is served by the local dev server
  (`node tools/dev-server.cjs`), the structured game log streams to
  `logs/<gameId>.txt` through `POST /api/log`; `logs/` is git-ignored and each file is
  capped. The browser cannot write files itself, so on any other host the endpoint probe
  fails, the log stays in memory, and `window.BT_LOG` / Ctrl+Shift+L downloads it. The
  stream is a development aid: it never blocks play, a broken stream disables itself after
  one warning, and it is not part of the shipped game rules.

---

## 5. Process

**Audit → fix → verify.**

- Every finding has `file:line`, the manual page and quote, a severity, and the evidence
  (a probe or a test that demonstrates it).
- Every remediation is recorded as **fixed / partial / deferred / wontfix** with one line of
  evidence. Deferrals are named, not silently dropped.
- A fix ships with a regression test that **fails on the old code**.
- Verification probes the shipped behaviour against the manual; a green suite is necessary
  but not sufficient. "Tests pass" is not evidence that the rule is right.

**Parallel work.**

- One writer per file. Shared files are sequenced by dependencies, never edited
  concurrently.
- Task scope is explicit; a member that needs to touch a file outside its scope reports it
  rather than editing.
- Changes are committed only on a settled, green tree, with the caveats stated in the
  message.

**Coverage** is a ratchet against erosion, not a target. It does not prove correctness.

---

## 6. Known accepted gaps

These are deliberate and recorded, not forgotten:

- **Phase A dead wiring** — movement heat, skidding, MASC activation and the 20+ damage PSR
  are implemented but not invoked from the live engine. This is accepted technical debt.
- **Unit elevation** — units have no floor/roof model beyond `position.level`, which no
  movement path writes; roof combat needs scenario setup.
- **Reachability gaps** — hidden-unit deployment, minefield placement and scheduled
  support have no in-game producer yet.
- **UI gaps** — no landing-facing picker, no jungle/sand renderer colours.

See `docs/RULES_COMPLIANCE_SWEEP.md` for the full list with severities.
