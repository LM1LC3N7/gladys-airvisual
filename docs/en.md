# AirVisual

**Unofficial connector, not affiliated with IQAir.** It brings into Gladys
the air quality of your houses and of the cities you choose, read through the
official [IQAir AirVisual API](https://www.iqair.com/air-pollution-data-api),
and the values of your **AirVisual Pro** monitors, read through their cloud
link.

> **This integration has never been tested with a real API key nor with a
> real AirVisual Pro.** It follows the official API documentation and
> pyairvisual, the Python client Home Assistant uses. Please report what you
> see on the Gladys forum.

## What you get

| Device in Gladys                      | Sensors                                                                                 |
| ------------------------------------- | --------------------------------------------------------------------------------------- |
| **AirVisual _house_** (one per house) | US AQI, China AQI, main pollutant (US), main pollutant (China), of the nearest city     |
| **AirVisual _city_**                  | the same values for a city you entered                                                  |
| **_name_ (AirVisual Pro)**            | US and China AQI (when the monitor sends them), PM2.5, PM10, CO2, temperature, humidity |

- AQI: `airquality-sensor` features (unit "AQI"); main pollutant: a text
  (PM2.5, PM10, O3, NO2, SO2, CO); PM2.5 and PM10 in µg/m³, CO2 in ppm,
  temperature in °C, humidity in %.
- AirVisual updates a city about once an hour; a value older than 3 hours
  (1 hour for a monitor) is not sent to Gladys as current.
- The names of the devices and the sensors are in English; rename them when
  you create them if you wish.

## Installation

1. On the [IQAir dashboard](https://dashboard.iqair.com/personal/api-keys),
   create a free **Community** API key.
2. Install the integration from the Gladys catalog (Gladys 5.1 or newer) and
   accept the access to the **location of your houses** (used to find the
   nearest city of each house).
3. In the **Configuration** screen, paste the key and save. Optionally, add
   cities and AirVisual Pro ids (see below).
4. Click **Test AirVisual**: the message lists the locations and their last
   values.
5. Open the **Discovery** tab and add the devices you want. Their values
   arrive as soon as they are created.

## Configuration

- **API key**: kept by Gladys in its database (in clear, like every secret
  field of Gladys), never shown again in the configuration screen, never
  written in the logs, and sent only to `api.airvisual.com`.
- **Air quality of the houses** (on by default): one location per house that
  has a position in Gladys (Settings → Houses). The position, rounded to 2
  decimals (about 1 km), is sent to AirVisual, which answers with its nearest
  city.
- **Cities**: written as AirVisual writes them, `City, State, Country`,
  separated by `;`, for example
  `Paris, Ile-de-France, France; Lyon, Auvergne-Rhone-Alpes, France`. A wrong
  spelling gives "not found" in the status; the spelling AirVisual uses is the
  one of its website (iqair.com) and of its `states` / `cities` lists.
  **Five locations at most**, houses included.
- **Read interval of each location** (30 minutes by default, 10 to 360).
- **AirVisual Pro ids**: on the IQAir dashboard, open the monitor and copy
  the id of its API link (or the whole link,
  `https://device.iqair.com/v2/...` or
  `https://www.airvisual.com/api/v2/node/...`; no other address is accepted).
  Separate several with commas, five at most. The id gives access to the
  values of the monitor: it is a secret field, never shown again, so enter
  the whole list to change it. In Gladys, a monitor is known by a hash of its
  id, never by the id itself. No API key is needed for the monitors.
- **Read interval of the AirVisual Pro** (10 minutes by default, 5 to 60).

## Usage limits (free "Community" plan)

The free plan allows **10,000 calls a month**, 500 a day and about 5 a
minute. The integration stays below, whatever the configuration:

- one call per location at each interval; a start of the container reads
  every location once (a reconnection to Gladys does not); one call per click
  on the test button (it reads only the first location and shows the last
  values of the others);
- never two calls less than 13 seconds apart (4.6 a minute at most);
- at most **290 calls per UTC day** (8,990 a month), counted in a file under
  `/data` so a restart does not reset it; the periodic reads stop at 270 and
  keep 20 for the test button. Past that, the reads resume after midnight
  UTC;
- the interval is raised automatically when the locations would not fit:
  five locations are read every 27 minutes at least.

| Locations | Default interval | Calls a day | Calls a month |
| --------- | ---------------- | ----------- | ------------- |
| 1         | 30 min           | 48          | about 1,490   |
| 3         | 30 min           | 144         | about 4,460   |
| 5         | 30 min           | 240         | about 7,440   |

When AirVisual answers **429** ("call limit reached" or "too many
requests"), every call with the key pauses, the test button included: the
`Retry-After` delay if AirVisual gives one, otherwise 1 minute for "too many
requests" and 1 hour, doubling, for "call limit reached"; always between 1
minute and 6 hours. A pause survives a reconnection to Gladys.

When AirVisual **refuses the key** (wrong, expired, without access), the
reads with the key stop and the status says so; one new try every 6 hours
(the test button may try at once), until you change the key. The AirVisual
Pro monitors keep being read.

The AirVisual Pro links do not use the API key; they are read at their own
interval, one call at a time, 2 seconds apart.

## Troubleshooting

- **"AirVisual refused the API key"**: check the key on the IQAir dashboard;
  a Community key expires after a year and must be renewed there.
- **"not found"** next to a city: check its spelling (city, state, country,
  in English, as on iqair.com).
- **"no city nearby"**: AirVisual has no city close enough to the position
  of the house; enter a city instead.
- **"The daily call budget of the free plan is spent"**: another tool may use
  the same key; the reads resume after midnight UTC.
- Logs: the level is set with the `LOG_LEVEL` variable.

## Privacy

The positions of the houses (rounded to about 1 km) and the cities you enter
are sent to AirVisual (IQAir) to read their air quality. The key goes only to
`api.airvisual.com`, the monitor ids only to the two AirVisual hosts above,
over HTTPS.

## Credits

Built after the official AirVisual API documentation and
[pyairvisual](https://github.com/bachya/pyairvisual) (MIT, Aaron Bach), the
Python client of Home Assistant's AirVisual integrations: endpoints, error
messages, node answers. Its notice is in `THIRD_PARTY_NOTICES.md`. AirVisual
and IQAir are trademarks of their owner; this connector is free and
unofficial.
