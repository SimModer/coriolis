/**
 * LinkMigration.js
 *
 * Handles decoding of OLD-style (v1/v2, 'A'/digit) build links for the small set
 * of ships that gained or re-sized internal slots after those links could have
 * been created. Old-style links are positional against the ship's PRE-CHANGE
 * coriolis-data `slots.internal` order; the live data now uses the NEW order
 * (matching coriolis-data/ships/ship-slots.json). This module remaps a decoded
 * old-order internal array onto the new order so modules land in their original
 * slots and genuinely-new slots are left empty.
 *
 * It also powers old-style imports (journal / Companion API) for the same ships.
 *
 * The remap is purely data-driven: bucket OLD slots by (kind|class) in order, then
 * walk the NEW layout and let each NEW slot claim the next OLD module from its
 * matching bucket. New slots with no matching OLD module stay empty; surplus OLD
 * modules (an old-style link that DOES carry enough to fill a new slot) fall into
 * the new slots in order. See coriolis/docs/link-format-v3.md.
 */

import { Ships } from 'coriolis-data/dist';

/**
 * PRE-CHANGE internal layouts, as the kind+class of each slot in the order that
 * old (v1/v2) links are positional against. Keyed by coriolis ship id.
 *
 * kind: 'num' (ordinary numbered slot), 'mil' (Military), 'cargo' (Cargo),
 *       'pas' (PlanetaryApproachSuite). Only ships that CHANGED are listed; any
 *       ship not present here has no migration and uses the normal path.
 *
 * Captured 2026-10-23 from coriolis-data prior to adopting ship-slots.json order.
 */
export const OLD_INTERNAL_LAYOUTS = {
  type_6_transporter: [
    { kind: 'num', class: 5 }, { kind: 'num', class: 5 }, { kind: 'num', class: 4 },
    { kind: 'num', class: 4 }, { kind: 'num', class: 3 }, { kind: 'num', class: 2 },
    { kind: 'num', class: 2 }, { kind: 'num', class: 1 }, { kind: 'pas', class: 1 },
  ],
  type_7_transport: [
    { kind: 'num', class: 6 }, { kind: 'num', class: 6 }, { kind: 'num', class: 6 },
    { kind: 'num', class: 5 }, { kind: 'num', class: 5 }, { kind: 'num', class: 5 },
    { kind: 'num', class: 3 }, { kind: 'num', class: 3 }, { kind: 'num', class: 2 },
    { kind: 'num', class: 1 }, { kind: 'pas', class: 1 },
  ],
  imperial_clipper: [
    { kind: 'num', class: 7 }, { kind: 'num', class: 6 }, { kind: 'num', class: 4 },
    { kind: 'num', class: 4 }, { kind: 'num', class: 3 }, { kind: 'num', class: 3 },
    { kind: 'num', class: 2 }, { kind: 'num', class: 2 }, { kind: 'num', class: 1 },
    { kind: 'pas', class: 1 },
  ],
  federal_dropship: [
    { kind: 'num', class: 6 }, { kind: 'num', class: 5 }, { kind: 'num', class: 5 },
    { kind: 'num', class: 4 }, { kind: 'mil', class: 4 }, { kind: 'mil', class: 4 },
    { kind: 'num', class: 3 }, { kind: 'num', class: 3 }, { kind: 'num', class: 2 },
    { kind: 'num', class: 1 }, { kind: 'pas', class: 1 },
  ],
};

/**
 * Determine whether a ship needs old-link internal migration.
 * @param {String} shipId coriolis ship id
 * @return {Boolean} true if the ship's internal layout changed
 */
export function needsInternalMigration(shipId) {
  return Object.prototype.hasOwnProperty.call(OLD_INTERNAL_LAYOUTS, shipId);
}

/**
 * The kind of a NEW (current data) internal slot definition.
 * @param {Object|Number} slotDef coriolis-data slots.internal entry
 * @return {String} kind
 */
function newSlotKind(slotDef) {
  if (typeof slotDef !== 'object') return 'num';
  const name = slotDef.name || '';
  if (name === 'PlanetaryApproachSuite') return 'pas';
  if (name === 'Military') return 'mil';
  if (name === 'Cargo') return 'cargo';
  return 'num';
}

/**
 * The class of a NEW internal slot definition.
 * @param {Object|Number} slotDef coriolis-data slots.internal entry
 * @return {Number} class
 */
function newSlotClass(slotDef) {
  return typeof slotDef === 'object' ? slotDef.class : slotDef;
}

/**
 * Build the OLD-index -> NEW-index map for a changed ship, plus the NEW-length.
 * newFromOld[newIndex] = oldIndex, or null when the new slot has no old match.
 * @param {String} shipId coriolis ship id (must be in OLD_INTERNAL_LAYOUTS)
 * @return {{ newFromOld: Array<Number|null>, newLength: Number }}
 */
export function buildInternalRemap(shipId) {
  const oldLayout = OLD_INTERNAL_LAYOUTS[shipId];
  const newLayout = Ships[shipId].slots.internal;

  // Bucket old indices by kind|class in order.
  const buckets = {};
  oldLayout.forEach((o, i) => {
    const key = o.kind + '|' + o.class;
    (buckets[key] = buckets[key] || []).push(i);
  });

  const newFromOld = newLayout.map((s) => {
    const key = newSlotKind(s) + '|' + newSlotClass(s);
    const b = buckets[key];
    if (b && b.length) return b.shift();
    return null;
  });

  return { newFromOld, newLength: newLayout.length };
}

/**
 * Remap a decoded OLD-order internal array (of module id strings / 0 / '-') onto
 * the NEW internal order for a changed ship. Returns a fresh array of newLength.
 * Parallel arrays (priorities, enabled, modifications, blueprints) can be remapped
 * with remapInternalParallel using the same map.
 * @param {String} shipId coriolis ship id
 * @param {Array} oldInternal decoded internal array in OLD order
 * @return {Array} internal array in NEW order (new slots = 0)
 */
export function remapInternalArray(shipId, oldInternal) {
  const { newFromOld, newLength } = buildInternalRemap(shipId);
  const out = new Array(newLength);
  for (let ni = 0; ni < newLength; ni++) {
    const oi = newFromOld[ni];
    out[ni] = (oi === null || oldInternal[oi] === undefined) ? 0 : oldInternal[oi];
  }
  return out;
}

/**
 * Remap a parallel per-internal-slot array (priorities / enabled / modifications /
 * blueprints) from OLD order to NEW order, inserting `fill` for new slots.
 * @param {String} shipId coriolis ship id
 * @param {Array} oldArr parallel array in OLD internal order
 * @param {*} fill value to use for genuinely-new slots
 * @return {Array} parallel array in NEW internal order
 */
export function remapInternalParallel(shipId, oldArr, fill) {
  if (!oldArr) return oldArr;
  const { newFromOld, newLength } = buildInternalRemap(shipId);
  const out = new Array(newLength);
  for (let ni = 0; ni < newLength; ni++) {
    const oi = newFromOld[ni];
    out[ni] = (oi === null || oldArr[oi] === undefined) ? fill : oldArr[oi];
  }
  return out;
}
