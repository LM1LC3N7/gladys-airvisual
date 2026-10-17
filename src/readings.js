// -----------------------------------------------------------------------------
// AirVisual answers -> plain readings, and the Gladys devices and states built
// from them. Pure: `now` is a parameter.
//
//   city / nearest_city  data.current.pollution { ts, aqius, mainus, aqicn, maincn }
//   node                 current { ts, aqius?, aqicn?, p2, p1, co, tp, hm }
//                        (p2 / p1: a number, or { conc, aqius, aqicn })
//
// The feature key of a value is its AirVisual field name (`aqius`, `p2`...):
// it is part of the external id, so it never changes.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import { DEVICE_TYPES, STALE_CITY, STALE_NODE } from './constants.js';

/** A finite number, or null. */
export const num = (value) =>
  value === null ||
  value === undefined ||
  value === '' ||
  typeof value === 'boolean' ||
  !Number.isFinite(Number(value))
    ? null
    : Number(value);

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

const text = (value, max = 80) =>
  typeof value === 'string'
    ? [...value]
        .filter((c) => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) !== 0x7f)
        .join('')
        .trim()
        .slice(0, max)
    : '';

/** AirVisual pollutant codes, as Gladys shows them. */
export const POLLUTANTS = {
  p2: 'PM2.5',
  p1: 'PM10',
  o3: 'O3',
  n2: 'NO2',
  s2: 'SO2',
  co: 'CO',
};

/** A pollutant code -> its name; an unknown code is kept, reduced to [a-z0-9]. */
export function pollutantName(code) {
  if (typeof code !== 'string' || !code) {
    return null;
  }
  const key = code.toLowerCase();
  return POLLUTANTS[key] ?? (key.replace(/[^a-z0-9]/g, '').slice(0, 12) || null);
}

// --- Kinds: Gladys category, type, unit and bounds ------------------------------
// Only the units the core lists for the category
// (DEVICE_FEATURE_UNITS_BY_CATEGORY of server/utils/constants.js).

const KINDS = {
  aqi: {
    category: CAT.AIRQUALITY_SENSOR,
    type: TYPES.AIRQUALITY_SENSOR.AQI,
    unit: UNITS.AQI,
    min: 0,
    max: 999,
    convert: (v) => Math.round(v),
  },
  pollutant: {
    category: CAT.TEXT,
    type: TYPES.TEXT.TEXT,
    min: 0,
    max: 0,
    text: true,
  },
  pm25: {
    category: CAT.PM25_SENSOR,
    type: TYPES.SENSOR.DECIMAL,
    unit: UNITS.MICROGRAM_PER_CUBIC_METER,
    min: 0,
    max: 2000,
    convert: (v) => round(v, 1),
  },
  pm10: {
    category: CAT.PM10_SENSOR,
    type: TYPES.SENSOR.DECIMAL,
    unit: UNITS.MICROGRAM_PER_CUBIC_METER,
    min: 0,
    max: 2000,
    convert: (v) => round(v, 1),
  },
  co2: {
    category: CAT.CO2_SENSOR,
    type: TYPES.SENSOR.INTEGER,
    unit: UNITS.PPM,
    min: 0,
    max: 10000,
    convert: (v) => Math.round(v),
  },
  temperature: {
    category: CAT.TEMPERATURE_SENSOR,
    type: TYPES.SENSOR.DECIMAL,
    unit: UNITS.CELSIUS,
    min: -40,
    max: 85,
    convert: (v) => round(v, 1),
  },
  humidity: {
    category: CAT.HUMIDITY_SENSOR,
    type: TYPES.SENSOR.DECIMAL,
    unit: UNITS.PERCENT,
    min: 0,
    max: 100,
    convert: (v) => round(v, 1),
  },
};

/** [field, kind, name] of a location (house or city). */
export const LOCATION_FIELDS = [
  ['aqius', 'aqi', 'Air quality index (US)'],
  ['aqicn', 'aqi', 'Air quality index (China)'],
  ['mainus', 'pollutant', 'Main pollutant (US)'],
  ['maincn', 'pollutant', 'Main pollutant (China)'],
];

/** [field, kind, name] of an AirVisual Pro / Node. */
export const NODE_FIELDS = [
  ['aqius', 'aqi', 'Air quality index (US)'],
  ['aqicn', 'aqi', 'Air quality index (China)'],
  ['p2', 'pm25', 'PM2.5'],
  ['p1', 'pm10', 'PM10'],
  ['co', 'co2', 'CO2'],
  ['tp', 'temperature', 'Temperature'],
  ['hm', 'humidity', 'Humidity'],
];

// --- Readings -------------------------------------------------------------------------

const timeOf = (ts) => {
  const t = typeof ts === 'string' || typeof ts === 'number' ? Date.parse(ts) : NaN;
  return Number.isFinite(t) ? t : NaN;
};

/** A `city` / `nearest_city` answer -> { city, state, country, ts, values }. */
export function cityReading(data) {
  const pollution = data?.current?.pollution ?? {};
  return {
    city: text(data?.city),
    state: text(data?.state),
    country: text(data?.country),
    ts: timeOf(pollution.ts),
    values: {
      aqius: num(pollution.aqius),
      aqicn: num(pollution.aqicn),
      mainus: pollutantName(pollution.mainus),
      maincn: pollutantName(pollution.maincn),
    },
  };
}

/** A pollutant of a node: a number, or `{ conc, aqius, aqicn }`. */
const concentration = (value) =>
  value && typeof value === 'object' ? num(value.conc) : num(value);

/** A node answer -> { name, ts, values }. */
export function nodeReading(doc) {
  const current = doc?.current ?? {};
  const p2 = current.p2 && typeof current.p2 === 'object' ? current.p2 : {};
  return {
    name: text(doc?.settings?.node_name ?? doc?.name, 60),
    ts: timeOf(current.ts),
    values: {
      aqius: num(current.aqius ?? p2.aqius),
      aqicn: num(current.aqicn ?? p2.aqicn),
      p2: concentration(current.p2),
      p1: concentration(current.p1),
      co: num(current.co),
      tp: num(current.tp),
      hm: num(current.hm),
    },
  };
}

/** A reading recent enough to be published as current. */
export function isFresh(reading, now) {
  const max = reading?.source?.type === DEVICE_TYPES.NODE ? STALE_NODE : STALE_CITY;
  return Number.isFinite(reading?.ts) && now - reading.ts <= max && reading.ts - now <= max;
}

// --- Gladys devices and states ------------------------------------------------------

const fieldsOf = (source) => (source.type === DEVICE_TYPES.NODE ? NODE_FIELDS : LOCATION_FIELDS);

/** The values of a reading, as features: a value it lacks is left out. */
export function sensorsOf(reading) {
  const sensors = [];
  for (const [field, kindName, name] of fieldsOf(reading.source)) {
    const raw = reading.values?.[field];
    if (raw === null || raw === undefined) {
      continue;
    }
    const kind = KINDS[kindName];
    sensors.push({ field, name, ...kind, value: kind.text ? raw : kind.convert(raw) });
  }
  return sensors;
}

const idsOf = (gladys, source) => gladys.externalIds(source.type, source.key);

/** The Gladys device of a reading (one per location or node). */
export function deviceOf(gladys, reading) {
  const ids = idsOf(gladys, reading.source);
  return {
    name: reading.source.name,
    external_id: ids.device,
    // The integration reads AirVisual at its own pace: Gladys has nothing to poll.
    should_poll: false,
    features: sensorsOf(reading).map((sensor) => ({
      name: sensor.name,
      external_id: ids.feature(sensor.field),
      category: sensor.category,
      type: sensor.type,
      ...(sensor.unit ? { unit: sensor.unit } : {}),
      min: sensor.min,
      max: sensor.max,
      read_only: true,
      has_feedback: false,
      keep_history: !sensor.text,
    })),
  };
}

/** The states of a reading, for the publishStates format. */
export function statesOf(gladys, reading) {
  const ids = idsOf(gladys, reading.source);
  return sensorsOf(reading).map((sensor) =>
    sensor.text
      ? { device_feature_external_id: ids.feature(sensor.field), text: sensor.value }
      : { device_feature_external_id: ids.feature(sensor.field), state: sensor.value },
  );
}
