# GLM-L2-LCFA files

What BoltClock reads from NOAA's GOES-19 Geostationary Lightning Mapper product, and how. The parser is [`src/server/glm/parse.ts`](../src/server/glm/parse.ts); the object-name helpers are in [`src/server/glm/filename.ts`](../src/server/glm/filename.ts).

## The files

- One NetCDF4 (HDF5) file per 20-second window, about 200–350 KB, under `GLM-L2-LCFA/YYYY/DDD/HH/` in the public `noaa-goes19` bucket. `DDD` is the UTC day of the year.
- Names carry the window and creation time: `OR_GLM-L2-LCFA_G19_s<start>_e<end>_c<created>.nc`, each time written as `YYYYDDDHHMMSSt` (t is tenths of a second).
- Each file covers the whole GOES-East field of view (the Americas, most of the Atlantic and the eastern Pacific), not one location. Every reader filters for its own point and radius.
- The archive has gaps. On 2026-07-15 there are no files after 20:00 UTC. A missing file is not proof that there was no lightning, which is why the display tracks the newest file end time and shows "NO LIGHTNING DATA" when it gets old.

## Variables BoltClock uses

| Variable | Stored as | Meaning in BoltClock |
| --- | --- | --- |
| `flash_id` | int16, `_Unsigned = true` | Flash id, unique only within one file. A global id is the file start time plus this id. |
| `flash_time_offset_of_first_event` | int16, `_Unsigned = true`, `scale_factor` 0.0003814756, `add_offset` −5.0, `units` "seconds since \<file start\>" | Time of the flash: base time from `units` plus `raw × scale_factor + add_offset` seconds. A flash can start up to 5 s before its file's window. |
| `flash_lat`, `flash_lon` | float32, no packing | Energy-weighted flash centroid in degrees. GLM pixels are about 8 km, hence "accurate within ±5 miles". |
| `flash_quality_flag` | int16, `_Unsigned = true` | 0 is good. 1, 3 and 5 mark degraded flashes, which BoltClock leaves out by default. |
| `time_coverage_start`, `time_coverage_end` (global attributes) | ISO 8601 text | The file's window. The newest end time drives the staleness check. |

The int16 variables must be read as unsigned before scaling: real files contain flash ids above 32767.

## How many flashes

Sampled 2026-10-17 with the parser, one file per UTC hour, degraded flashes left out:

| Day | Files | Good flashes per file, average / most | 1° grid cells touched per file, average / most | Most flashes in one cell in one file |
| --- | --- | --- | --- | --- |
| 2026-10-16 | 24 | 293 / 567 | 109 / 163 | 31 |
| 2026-07-15 (00–20 UTC) | 21 | 182 / 297 | 72 / 152 | 24 |
| 2026-08-15 (12–23 UTC) | 9 | 244 / 478 | 108 / 175 | 25 |

So a file brings a few hundred flashes spread over one to two hundred 1° cells, with fewer than 100 in any one cell. Storing flashes by grid cell (BOLT-15) therefore takes one batch write per touched cell per file. These are hourly samples, so short bursts can be higher; design for a few thousand flashes in a file.
