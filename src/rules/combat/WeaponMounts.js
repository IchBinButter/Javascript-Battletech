/**
 * WeaponMounts - map each mounted weapon to the physical critical-slot
 * component it occupies (p46).
 *
 * Firing identity is per mounted weapon (GameEngine's `weaponIndex`), and a
 * critical hit destroys a physical COMPONENT:
 *
 * - a single-slot item (medium laser, machine gun) is destroyed by its one
 *   slot, so two identical mounts in one location are two separate components
 *   and losing one slot disables only its own mount;
 * - a multi-slot item (AC/20 fills 10 slots, LRM-20 five, PPC three, SRM-6 two)
 *   is ONE component: a critical hit on any of its slots disables the whole
 *   item.
 *
 * The roster does not say which slots belong to which identical mount, and
 * weapons.json has no critical-slot count (only a stray `crits` on one entry),
 * so the mapping is derived from the record sheet itself:
 *
 * - `slots` are the `criticalSlots[location]` entries whose `item` is the
 *   mount's weapon id, in record-sheet (slot number) order;
 * - `mounts` are the `equipment.weapons` entries with that id in that location;
 * - one component fills a contiguous chunk of `slots / mounts` slots, in mount
 *   order, and the last mount takes any remainder.
 *
 * This is the same component size DamageResolver uses (`slotsPerComponent` =
 * slots / mounts), so the slots damage already treats as one component are
 * exactly the slots that disable one mount.
 *
 * Everything here is a pure function of the unit: no engine state, no dice and
 * no mutation of the unit or its critical slots.
 */

/** Stable identity of a mounted weapon's component: `<type>@<location>#<index>`. */
export function weaponMountKey(weaponType, location, weaponIndex) {
  return `${weaponType || 'weapon'}@${location || 'unknown'}#${weaponIndex}`;
}

/**
 * The critical-slot component of every mounted weapon, aligned with
 * `unit.equipment.weapons` (entry i is the component for mount i).
 *
 * @param {object} unit - unit with `equipment.weapons` and `criticalSlots`
 * @returns {Array<{index: number, key: string, type: string|null,
 *   location: string|null, slots: Array<object>, destroyed: boolean}>}
 *   `slots` are the critical-slot records the component occupies (empty when
 *   the unit carries no record-sheet slots for that mount, which leaves it
 *   intact), and `destroyed` is true when any of those slots is destroyed.
 */
export function weaponMountComponents(unit) {
  const weapons = Array.isArray(unit && unit.equipment && unit.equipment.weapons)
    ? unit.equipment.weapons
    : [];
  const criticalSlots = (unit && unit.criticalSlots) || {};

  // Ordinal of each mount inside its (location, item) group: mounts of the
  // same weapon in the same location take the chunks of slots in that order.
  const mountsPerGroup = new Map();
  const ordinals = weapons.map(() => 0);
  weapons.forEach((entry, index) => {
    if (!entry || !entry.type || !entry.location) return;
    const group = groupOf(entry);
    ordinals[index] = mountsPerGroup.get(group) || 0;
    mountsPerGroup.set(group, ordinals[index] + 1);
  });

  return weapons.map((entry, index) => {
    const type = (entry && entry.type) || null;
    const location = (entry && entry.location) || null;
    const component = {
      index,
      key: weaponMountKey(type, location, index),
      type,
      location,
      slots: [],
      destroyed: false
    };

    if (!type || !location) return component;

    const itemSlots = slotsForItem(criticalSlots, location, type);
    // No record-sheet slots for this mount: there is nothing to destroy.
    if (itemSlots.length === 0) return component;

    const group = groupOf(entry);
    const mounts = mountsPerGroup.get(group) || 1;
    const ordinal = ordinals[index] || 0;
    // Component size from the data. Math.round matches DamageResolver's
    // slotsPerComponent for the same roster; real record sheets divide exactly.
    const perMount = Math.max(1, Math.round(itemSlots.length / mounts));

    const start = ordinal * perMount;
    const end = ordinal === mounts - 1
      ? itemSlots.length
      : Math.min(itemSlots.length, start + perMount);
    component.slots = start < itemSlots.length ? itemSlots.slice(start, end) : [];
    component.destroyed = component.slots.some(slot => slot && slot.status === 'destroyed');
    return component;
  });
}

/** The component for one mounted weapon, by index into `unit.equipment.weapons`. */
export function weaponMountAt(unit, weaponIndex) {
  if (weaponIndex === null || weaponIndex === undefined || weaponIndex === '') return null;
  const index = Number(weaponIndex);
  if (!Number.isInteger(index) || index < 0) return null;
  return weaponMountComponents(unit)[index] || null;
}

/**
 * The component for a specific mounted entry, looked up by object identity so
 * the second of two identical entries resolves to its own mount, not the first.
 */
export function weaponMountFor(unit, entry) {
  const weapons = Array.isArray(unit && unit.equipment && unit.equipment.weapons)
    ? unit.equipment.weapons
    : [];
  const index = weapons.indexOf(entry);
  return index < 0 ? null : weaponMountAt(unit, index);
}

/** Is the component of the mount at `weaponIndex` destroyed? */
export function isWeaponMountDestroyed(unit, weaponIndex) {
  const component = weaponMountAt(unit, weaponIndex);
  return Boolean(component && component.destroyed);
}

function groupOf(entry) {
  return `${entry.location}\u0000${entry.type}`;
}

/** The critical slots for `item` in `location`, in record-sheet slot order. */
function slotsForItem(criticalSlots, location, item) {
  const slots = Array.isArray(criticalSlots[location]) ? criticalSlots[location] : [];
  return slots
    .filter(slot => slot && slot.item === item)
    .sort((a, b) => slotNumber(a) - slotNumber(b));
}

/** Slot number for ordering; missing numbers sort last and keep their order. */
function slotNumber(slot) {
  const value = Number(slot && slot.slot);
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}
