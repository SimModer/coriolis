/**
 * Old-link (v1/v2) internal-slot migration tests.
 *
 * Four ships gained or re-sized internal slots after old positional links could
 * have been created: type_6_transporter, type_7_transport, imperial_clipper and
 * federal_dropship. Old links are positional against the PRE-CHANGE internal
 * order (OLD_INTERNAL_LAYOUTS); decoding them must remap modules onto the current
 * ship-slots.json order so each module lands in its original slot and genuinely
 * new slots stay empty. See docs/link-format-v3.md and LinkMigration.js.
 */
import { Ships } from 'coriolis-data/dist';
import Ship from '../src/app/shipyard/Ship';
import {
  OLD_INTERNAL_LAYOUTS,
  needsInternalMigration,
  buildInternalRemap,
  remapInternalArray,
  remapInternalParallel
} from '../src/app/shipyard/LinkMigration';

const CHANGED = ['type_6_transporter', 'type_7_transport', 'imperial_clipper', 'federal_dropship'];

/**
 * Current internal layout as {kind,class} pairs for comparison.
 * @param {String} shipId coriolis ship id
 * @return {Array} array of {kind,class}
 */
function newLayout(shipId) {
  return Ships[shipId].slots.internal.map((s) => {
    if (typeof s !== 'object') return { kind: 'num', class: s };
    const name = s.name || '';
    let kind = 'num';
    if (name === 'PlanetaryApproachSuite') kind = 'pas';
    else if (name === 'Military') kind = 'mil';
    else if (name === 'Cargo') kind = 'cargo';
    return { kind, class: s.class };
  });
}

describe('old-link internal migration', () => {

  it('flags exactly the four changed ships as needing migration', () => {
    for (const id of CHANGED) {
      expect(needsInternalMigration(id)).toBe(true);
    }
    // A representative unchanged ship
    expect(needsInternalMigration('anaconda')).toBe(false);
    expect(needsInternalMigration('sidewinder')).toBe(false);
  });

  describe('remap is consistent with the current layout', () => {
    for (const shipId of CHANGED) {
      it(`${shipId}: every new slot maps to a same-kind/class old slot or null`, () => {
        const { newFromOld, newLength } = buildInternalRemap(shipId);
        const nl = newLayout(shipId);
        const ol = OLD_INTERNAL_LAYOUTS[shipId];

        expect(newLength).toBe(nl.length);
        expect(newFromOld.length).toBe(newLength);

        for (let ni = 0; ni < newLength; ni++) {
          const oi = newFromOld[ni];
          if (oi === null) continue;
          // mapped old slot must match this new slot's kind and class
          expect(ol[oi].kind).toBe(nl[ni].kind);
          expect(ol[oi].class).toBe(nl[ni].class);
        }
      });

      it(`${shipId}: each old slot is claimed at most once`, () => {
        const { newFromOld } = buildInternalRemap(shipId);
        const used = newFromOld.filter((x) => x !== null);
        expect(new Set(used).size).toBe(used.length);
      });

      it(`${shipId}: new layout is at least as large as the old one`, () => {
        expect(Ships[shipId].slots.internal.length)
          .toBeGreaterThanOrEqual(OLD_INTERNAL_LAYOUTS[shipId].length);
      });
    }
  });

  it('remapInternalArray places old modules by matching slot and leaves new slots empty', () => {
    // Federal Dropship gained a class-6 slot at the front (Slot00_Size6) under the
    // new ship-slots order. Fabricate an old-order internal id array (distinct
    // markers) and confirm they migrate onto matching new slots.
    const shipId = 'federal_dropship';
    const old = OLD_INTERNAL_LAYOUTS[shipId];
    // Tag each old slot with a unique string id so we can trace placement.
    const oldInternal = old.map((_, i) => `m${i}`);

    const out = remapInternalArray(shipId, oldInternal);
    const { newFromOld } = buildInternalRemap(shipId);

    expect(out.length).toBe(Ships[shipId].slots.internal.length);
    for (let ni = 0; ni < out.length; ni++) {
      const oi = newFromOld[ni];
      if (oi === null) {
        expect(out[ni]).toBe(0); // genuinely new slot stays empty
      } else {
        expect(out[ni]).toBe(oldInternal[oi]); // original module preserved
      }
    }
    // The dropship gained at least one slot, so at least one new slot is empty.
    expect(out.filter((x) => x === 0).length).toBeGreaterThanOrEqual(1);
  });

  it('remapInternalParallel fills new slots with the supplied default', () => {
    const shipId = 'imperial_clipper';
    const old = OLD_INTERNAL_LAYOUTS[shipId];
    const oldPriorities = old.map((_, i) => String(i % 5));

    const out = remapInternalParallel(shipId, oldPriorities, '0');
    const { newFromOld } = buildInternalRemap(shipId);

    expect(out.length).toBe(Ships[shipId].slots.internal.length);
    for (let ni = 0; ni < out.length; ni++) {
      const oi = newFromOld[ni];
      expect(out[ni]).toBe(oi === null ? '0' : oldPriorities[oi]);
    }
  });

  describe('decoding old positional links for changed ships', () => {
    // valid-detailed-export.json carries v1 ('0'-prefixed) positional links for
    // these ships; decoding them exercises the full migration path.
    const expectedBuilds = require('./fixtures/expected-builds');
    const detailed = require('./fixtures/valid-detailed-export');

    for (const build of detailed) {
      const shipName = build.ship;
      const shipId = Object.keys(Ships).find(
        (id) => Ships[id].properties.name.toLowerCase() === shipName.toLowerCase()
      );
      if (!CHANGED.includes(shipId)) continue;

      it(`${shipId} "${build.name}" decodes an old v1 link without throwing and matches the regenerated v3 code`, () => {
        const sd = Ships[shipId];
        const ship = new Ship(shipId, sd.properties, sd.slots);
        // Old positional link from the fixture
        expect(() => ship.buildFrom(build.references[0].code)).not.toThrow();
        // Re-serialized to v3 and compared to the regenerated expectation
        expect(ship.toString()).toBe(expectedBuilds[shipId][build.name]);
      });
    }
  });
});
