# TODO

## Before announcing

- [ ] Test on a real Gladys 5.1+ with a real AirVisual Community key: the
      devices of the Discovery tab, their values, the status, the test
      button. Never done yet.
- [ ] Test with a real AirVisual Pro (both link shapes).
- [ ] Check the CI (Docker build, Node 22 and 24), then run the store
      validator once the image is published (at milestone 1 its only error
      is `docker_image` not yet pullable from GHCR). The Docker image was
      never built locally (no Docker on the development PC).
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Add the `gladys-assistant-integration` topic to publish in the store.

## To confirm

- [ ] The HTTP status of the API errors: pyairvisual reads the message of the
      body whatever the status; `call_limit_reached` is expected with a 429,
      `incorrect_api_key` with a 400 or 401. Both are handled.
- [ ] Whether `call_limit_reached` means the minute, the day or the month
      limit: a 1-hour pause, doubling up to 6 hours, is the prudent choice.
      Whether AirVisual sends `Retry-After` (used when it does).
- [ ] The cloud link of an AirVisual Pro: `www.airvisual.com/api/v2/node/<id>`
      (pyairvisual) and `device.iqair.com/v2/<id>` (the link the IQAir
      dashboard shares). Both are read; whether the first one still answers,
      and the exact shape of the second (`p2` as a number or as
      `{ conc, aqius, aqicn }`), are not verified.
- [ ] Whether the node calls count against the key quota: they do not send
      the key, so they should not.
- [ ] The answer to an expired Community key (`api_key_expired`).
- [ ] The core lists the PM2.5 / PM10 units as nested arrays
      (`[[MICROGRAM_PER_CUBIC_METER]]`) in `DEVICE_FEATURE_UNITS_BY_CATEGORY`:
      check that the UI shows `microgram-per-cubic-meter` well.

## Decisions

- **Version 0.1.0 set by hand** in `package.json`, `package-lock.json`, the
  manifest and the `docker_image` tag
  (`ghcr.io/lm1lc3n7/gladys-airvisual:0.1.0`); the first patch release gives
  0.1.1.
- **pyairvisual (MIT) as the reference**, not copied: Python, so the same
  endpoints and error handling are re-implemented in JavaScript, credited in
  the docs and in `THIRD_PARTY_NOTICES.md` (copied into the image with
  `LICENSE`).
- **No runtime dependency** besides the Gladys SDK (Node's `fetch`).
- **Device type, one device per location or monitor**, so each can sit in its
  own room. External ids: `house:<house selector>`, `city:<country>_<state>_<city>`
  (slugs), `node:<sha256(id)[0..16]>`, then the AirVisual field name
  (`aqius`, `aqicn`, `mainus`, `maincn`, `p2`, `p1`, `co`, `tp`, `hm`).
  The node id is a credential: never in an external id, a log or a message.
- **Categories and units of the core only**: `airquality-sensor`/`aqi` (unit
  `aqi`), `pm25-sensor` and `pm10-sensor` in `microgram-per-cubic-meter`,
  `co2-sensor` in `ppm`, `temperature-sensor` in `celsius`,
  `humidity-sensor` in `percent`, all from `DEVICE_FEATURE_UNITS_BY_CATEGORY`
  of `server/utils/constants.js` (checked by `test/manifest.test.js`). The
  main pollutant is a `text`/`text` feature (a string state, no history), with
  the AirVisual code shown as PM2.5, PM10, O3, NO2, SO2, CO.
- **No weather values of the cities** (temperature, humidity, wind of
  `current.weather`): a weather integration's job, and city temperatures
  would skew the room temperature of Gladys. The node temperature is indoor,
  where the monitor stands: kept.
- **Quota guard** (free plan: 10,000 calls a month, 500 a day, 5 a minute):
  default 30 minutes per location; the interval is raised to
  `ceil(locations × 1440 / 270)` minutes when needed; five locations at most;
  13 s between calls; a daily cap of 290 calls (8,990 a month) of which 20
  are kept for the test button, persisted in `/data/airvisual-budget.json`
  so a restart loop cannot drain the quota (if `/data` is not writable, the
  count stays in memory and a warning is logged).
- **The test button reads one location only** (the key check) and shows the
  last values of the others; it may use the reserve, and may retry a refused
  key at once, never during a 429 pause. Its timeout is 120 s: it can wait
  its turn behind a tick (13 s per call).
- **The Discovery tab never calls AirVisual**: it shows the places already
  read, to keep the quota.
- **429**: `Retry-After` when given, else 1 minute (`too_many_requests`) or
  1 hour doubling (`call_limit_reached`), always clamped to 1 minute – 6
  hours, checked inside the pacer for every call with the key (polls, test
  button, starts).
- **Refused key** (`incorrect_api_key`, `api_key_expired`,
  `Payment Required`, `permission_denied`, an AirVisual `Forbidden` /
  `feature_not_available`, any 401): the key reads stop and the status says
  it; one new try every 6 hours (never a dead integration), reset when the
  key changes. A bare 403 without the AirVisual error body counts as a
  passing failure, not a refusal.
- **A reconnection to Gladys** (`connected` event) keeps the client, the
  pauses, the refusal and the due times; only a new key (or a new interval)
  makes the locations due again.
- **Nodes are independent**: no key, their own pace (2 s) and 429 pause; a
  node down never blocks the locations and the reverse.
- **Node links**: a bare id, or a whole link of the two known hosts only
  (https, `device.iqair.com/v2/<id>` or `www.airvisual.com/api/v2/node/<id>`),
  so no other address can be called. The node ids field is a `secret`: the
  list must be entered whole to be changed.
- **The houses' positions** are rounded to 2 decimals (about 1 km) before
  they reach AirVisual.
- **Bounded answers**: 64 KB for the API, 1 MB for a node (its history comes
  with it); error messages keep the host only.
- **Freshness**: a city value older than 3 hours, a node value older than 1
  hour, is not published; an unchanged value is re-sent every 30 minutes.
- **The secret is not encrypted by Gladys**: the docs say "kept by Gladys in
  its database, never shown again, sent only to api.airvisual.com".

## Ideas

- Compute the US AQI from PM2.5 for a monitor that does not send it.
- The weather of the cities as an option.
- VOC and PM1 of the AirVisual Pro (`voc`, `p01`) once proven.
- The local Samba access of the AirVisual Pro (pyairvisual's `NodeSamba`),
  without cloud.
