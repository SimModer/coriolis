/**
 * SLEF (Ship Loadout Export Format) export tests.
 *
 * Spansh's Galaxy Plotter and other journal-Loadout consumers reject a SLEF
 * payload that lacks the calculated top-level values Frontier writes into a
 * journal Loadout event ("cannot parse ship"). toSLEF must emit, alongside the
 * module list: Ship (lowercase FD name), ShipName/ShipIdent, HullValue,
 * ModulesValue, UnladenMass, CargoCapacity, MaxJumpRange,
 * FuelCapacity {Main, Reserve} and Rebuy.
 */
import { Ships } from 'coriolis-data/dist';
import Ship from '../src/app/shipyard/Ship';
import * as Serializer from '../src/app/shipyard/Serializer';
import { shipModelFromJson } from '../src/app/utils/CompanionApiUtils';
import { shipFromLoadoutJSON } from '../src/app/utils/JournalUtils';

function slefData(shipId) {
  const sd = Ships[shipId];
  const ship = new Ship(shipId, sd.properties, sd.slots);
  ship.buildWith(sd.defaults);
  return { ship, data: Serializer.toSLEF('Test Build', ship)[0].data };
}

describe('SLEF export calculated values', () => {

  it('includes all Spansh-required top-level fields', () => {
    const { data } = slefData('explorer_nx');
    for (const key of [
      'Ship', 'ShipName', 'ShipIdent', 'HullValue', 'ModulesValue',
      'UnladenMass', 'CargoCapacity', 'MaxJumpRange', 'FuelCapacity', 'Rebuy', 'Modules'
    ]) {
      expect(data).toHaveProperty(key);
    }
    expect(data.FuelCapacity).toHaveProperty('Main');
    expect(data.FuelCapacity).toHaveProperty('Reserve');
  });

  it('emits the lowercase Frontier ship name (journal convention)', () => {
    expect(slefData('explorer_nx').data.Ship).toBe('explorer_nx');
    expect(slefData('krait_mkii').data.Ship).toBe('krait_mkii');
    expect(slefData('anaconda2').data.Ship).toBe('anacondamkii');
    expect(slefData('type_9_heavy').data.Ship).toBe('type9');
    // never the mixed-case SHIP_FD_NAME_TO_CORIOLIS_NAME key
    expect(slefData('explorer_nx').data.Ship).not.toBe('Explorer_NX');
  });

  it('computes values consistent with the ship', () => {
    const { ship, data } = slefData('explorer_nx');
    expect(data.HullValue).toBe(Math.round(ship.hullCost));
    expect(data.ModulesValue).toBe(Math.round(ship.totalCost - ship.hullCost));
    expect(data.CargoCapacity).toBe(ship.cargoCapacity);
    expect(data.FuelCapacity.Main).toBe(ship.fuelCapacity);
    expect(data.FuelCapacity.Reserve).toBe(ship.reserveFuelCapacity);
    expect(data.MaxJumpRange).toBeGreaterThan(0);
    expect(typeof data.MaxJumpRange).toBe('number');
  });

  it('computes Rebuy as 5% of hull + modules value (floored), like the game', () => {
    for (const id of ['explorer_nx', 'anaconda2', 'sidewinder']) {
      const { data } = slefData(id);
      expect(data.Rebuy).toBe(Math.floor((data.HullValue + data.ModulesValue) * 0.05));
    }
  });

  it('round-trips: the exported data re-imports to the same ship', () => {
    for (const id of ['explorer_nx', 'krait_mkii', 'anaconda2', 'federal_corvette']) {
      const { data } = slefData(id);
      expect(shipModelFromJson(data)).toBe(id);
      expect(() => shipFromLoadoutJSON(data)).not.toThrow();
    }
  });
});
