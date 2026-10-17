# gladys-airvisual

[Gladys Assistant](https://gladysassistant.com) external integration for
[IQAir AirVisual](https://www.iqair.com/air-pollution-data-api): the air
quality (US AQI, China AQI, main pollutant) of your houses and of the cities
you choose, through the official AirVisual API v2, and your AirVisual Pro
monitors (AQI, PM2.5, PM10, CO2, temperature, humidity) through their cloud
link. **Unofficial, not affiliated with IQAir. Never tested with a real API
key nor a real monitor yet.**

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/app.js (AirVisualApp)    what is due, devices, states, status, test button
                 ├─ src/airvisual.js         nearest_city, city, node; every guard of the key
                 ├─ src/pacer.js             one call at a time, 13 s apart (5 calls/min plan)
                 ├─ src/budget.js            290 calls per UTC day, persisted in /data
                 ├─ src/readings.js          answers -> readings, devices, states (pure)
                 └─ src/http.js              fetch, timeout, bounded body, host-only errors
```

- **Houses**: `GET https://api.airvisual.com/v2/nearest_city?lat&lon&key`
  (position rounded to 2 decimals) for each located house.
- **Cities**: `GET https://api.airvisual.com/v2/city?city&state&country&key`.
- **AirVisual Pro**: `GET https://www.airvisual.com/api/v2/node/<id>` or
  `https://device.iqair.com/v2/<id>`, no key.
- **Quota** (free plan, 10,000 calls a month): 30 minutes per location by
  default, raised to fit 270 periodic calls a day; 290 calls a day at most;
  13 s between calls; a 429 pauses every call (1 minute to 6 hours); a
  refused key stops the reads (one try every 6 hours).
- **Devices**: one per location or monitor, external ids
  `house:<selector>`, `city:<country>_<state>_<city>`, `node:<hash>`, then
  the AirVisual field (`aqius`, `aqicn`, `mainus`, `maincn`, `p2`, `p1`,
  `co`, `tp`, `hm`).

No runtime dependency besides the Gladys SDK.

## Development

```bash
npm install
npm test                                        # node --test, no network, no disk
npm run lint && npm run format:check
npm run audit                                   # npm audit --omit=dev
npx github:GladysAssistant/integration-store .  # store admission checks
node .github/scripts/cover.mjs                  # draws cover.png (no dependency)
```

The fixtures in `test/fixtures/` are example answers shaped after the
official documentation and pyairvisual's own fixtures.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags,
builds the multi-arch image to GHCR and publishes the GitHub Release.

## Credits

- AirVisual API v2 documentation (official): endpoints, parameters, plans.
- [pyairvisual](https://github.com/bachya/pyairvisual) (MIT, Aaron Bach):
  the Python client of Home Assistant's AirVisual integrations, followed for
  the endpoints, the error messages and the node answers. No code is copied;
  its notice is in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

Apache-2.0 ([LICENSE](LICENSE)). AirVisual and IQAir are trademarks of their
owner.
