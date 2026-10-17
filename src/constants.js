// -----------------------------------------------------------------------------
// Endpoints, quotas, pacing and the keys users store (manifest keys, device
// types): the keys are forever, never rename them.
// -----------------------------------------------------------------------------

/** The official IQAir AirVisual API (v2): `nearest_city`, `city`. */
export const API_URL = 'https://api.airvisual.com/v2';

/**
 * The cloud API of an AirVisual Pro / Node, by its id (no API key: the id is
 * the credential). `www.airvisual.com/api/v2/node/<id>` is the one pyairvisual
 * reads; `device.iqair.com/v2/<id>` is the link the IQAir dashboard shares.
 */
export const NODE_HOSTS = {
  airvisual: (id) => `https://www.airvisual.com/api/v2/node/${id}`,
  iqair: (id) => `https://device.iqair.com/v2/${id}`,
};

export const USER_AGENT = 'gladys-airvisual (+https://github.com/LM1LC3N7/gladys-airvisual)';

/** One HTTP call. */
export const HTTP_TIMEOUT = 15_000;

/** The most a city answer may weigh (about 1 KB in practice). */
export const MAX_API_BODY = 64 * 1024;

/** A node answer carries its history (hourly, daily, monthly): more room. */
export const MAX_NODE_BODY = 1024 * 1024;

/**
 * The free "Community" plan: 10 000 calls a month, 500 a day, 5 a minute.
 * The integration keeps to 290 calls per UTC day (290 × 31 = 8 990 a month),
 * The periodic reads (the first read of each location after a start
 * included) stop at 270; the last 20 are kept for the test button.
 */
export const DAILY_CALLS = 290;
export const DAILY_RESERVE = 20;

/** Never two calls with the API key closer than this: 4.6 a minute at most. */
export const API_MIN_GAP = 13_000;

/** The node host gets its own pace, out of politeness. */
export const NODE_MIN_GAP = 2_000;

/** At most this many locations and nodes (each one costs calls). */
export const MAX_LOCATIONS = 5;
export const MAX_NODES = 5;

/** How often the integration checks what is due. */
export const TICK = 60_000;

/** A 429: never shorter than a minute, never longer than 6 hours. */
export const LIMITED_MIN = 60_000;
export const LIMITED_MAX = 6 * 60 * 60_000;
/** `call_limit_reached` without Retry-After: 1 hour, doubling, up to 6 hours. */
export const LIMITED_QUOTA_BASE = 60 * 60_000;

/** A refused key: no call with it for 6 hours (or until the key changes). */
export const REFUSED_BACKOFF = 6 * 60 * 60_000;

/**
 * A location or node that failed (network, 5xx): tried again at its usual
 * interval, never sooner than this.
 */
export const FAILED_RETRY = 10 * 60_000;

/** A city not found, or no city near a house: tried again after this at least. */
export const NOT_FOUND_RETRY = 6 * 60 * 60_000;

/** The test button answers within this, with the last values if needed. */
export const TEST_DEADLINE = 100_000;

/** The hosts a node link may point to, or redirect to (https only). */
export const NODE_HOSTNAMES = ['www.airvisual.com', 'device.iqair.com'];

/** At most this many redirections of a node link. */
export const MAX_REDIRECTS = 3;

/** A reading older than this is not published as current. */
export const STALE_CITY = 3 * 60 * 60_000;
export const STALE_NODE = 60 * 60_000;

/** An unchanged value is re-sent this often, so Gladys keeps it recent. */
export const HEARTBEAT = 30 * 60_000;

/** Device types of the external ids (`ext:<selector>:<type>:<id>`). */
export const DEVICE_TYPES = {
  HOUSE: 'house',
  CITY: 'city',
  NODE: 'node',
};

/** Manifest `actions` keys. */
export const ACTIONS = {
  TEST: 'test_connection',
};
