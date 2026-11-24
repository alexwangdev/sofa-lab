/**
 * Every vehicle is one data row (spec §7–§8). Adding a timed vehicle = adding a row here; sim.ts reads only the flags.
 */
import type { BiomeId, VehicleDef, VehicleId } from './types.ts';

const BASE_FLAGS = {
  base: true,
  durationRows: Number.POSITIVE_INFINITY,
  lanesPerRow: 1,
  ignoreCrash: false,
  ignoreSlow: false,
  breakCrash: false,
  straightOnly: false,
  noCollect: false,
  noGate: false,
  jumpRows: 0,
  rampBonus: 1,
  turnCooldown: false,
  noRamp: false,
} as const;

const base = (id: string, name: string, biome: BiomeId): VehicleDef => ({ id, name, biomes: [biome], ...BASE_FLAGS });

type TimedFields = Partial<Omit<VehicleDef, 'id' | 'name' | 'biomes' | 'base' | 'durationRows'>>;
const timed = (id: string, name: string, biomes: BiomeId[], durationRows: number, f: TimedFields): VehicleDef => ({
  id,
  name,
  biomes,
  ...BASE_FLAGS,
  base: false,
  durationRows,
  ...f,
});

/** The "fly" modifier shared by Helicopter / Hot air balloon (one code path, two sprites). */
const FLY: TimedFields = { ignoreCrash: true, ignoreSlow: true, noCollect: true, noGate: true };
/** On-rails modifier shared by Zipline / Subway car. */
const RAILS: TimedFields = { straightOnly: true, ignoreCrash: true, ignoreSlow: true, noCollect: true, noGate: true };

export const VEHICLE_LIST: readonly VehicleDef[] = [
  // base vehicles: identical rules, different sprite and name
  base('ski', 'Ski', 'snow'),
  base('sandboard', 'Sandboard', 'desert'),
  base('heatboard', 'Heat board', 'volcano'),
  base('jetski', 'Jet ski', 'ocean'),
  base('oxcart', 'Ox cart', 'jungle'),
  base('skates', 'Ice skates', 'icefield'),
  base('skateboard', 'Skateboard', 'city'),
  base('rover', 'Moon rover', 'space'),
  // timed vehicles (§8)
  timed('snowmobile', 'Snowmobile', ['snow'], 10, { lanesPerRow: 2 }),
  timed('dogsled', 'Dog sled', ['snow'], 10, { ignoreSlow: true }),
  timed('helicopter', 'Helicopter', ['snow', 'volcano'], 8, FLY),
  timed('dunebuggy', 'Dune buggy', ['desert'], 10, { breakCrash: true }),
  timed('balloon', 'Hot air balloon', ['desert'], 8, FLY),
  timed('lavasurf', 'Lava surfboard', ['volcano'], 10, { ignoreCrash: true, straightOnly: true }),
  timed('submarine', 'Submarine', ['ocean'], 10, { ignoreCrash: true, ignoreSlow: true, noGate: true }),
  timed('speedboat', 'Speedboat', ['ocean'], 10, { lanesPerRow: 2, turnCooldown: true }),
  timed('zipline', 'Zipline', ['jungle'], 6, RAILS),
  timed('elephant', 'Elephant', ['jungle'], 10, { breakCrash: true, noRamp: true }),
  timed('icebreaker', 'Icebreaker', ['icefield'], 10, { breakCrash: true }),
  timed('dogteam', 'Dog team', ['icefield'], 10, { ignoreSlow: true }),
  timed('bicycle', 'Bicycle', ['city'], 10, { ignoreSlow: true, rampBonus: 2 }),
  timed('subway', 'Subway car', ['city'], 8, RAILS),
  timed('rocket', 'Rocket backpack', ['space'], 6, { jumpRows: 2 }),
];

const VEHICLES: ReadonlyMap<VehicleId, VehicleDef> = new Map(VEHICLE_LIST.map((v) => [v.id, v]));

export function vehicle(id: VehicleId): VehicleDef {
  const v = VEHICLES.get(id);
  if (!v) throw new Error(`unknown vehicle ${id}`);
  return v;
}

export const timedFor = (biome: BiomeId): VehicleDef[] => VEHICLE_LIST.filter((v) => !v.base && v.biomes.includes(biome));
