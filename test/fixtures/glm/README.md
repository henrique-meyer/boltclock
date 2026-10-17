# GLM test fixtures

- `OR_GLM-L2-LCFA_G19_s20261962021200_e20261962021400_c20261962021423.nc`: one unmodified GOES-19 GLM-L2-LCFA file (2026-07-15 20:21:20–20:21:40 UTC, 303 flashes, 6 of them degraded), from NOAA's public `noaa-goes19` bucket. NOAA data is public domain.
- `….expected.json`: the same file read by `xarray` with CF decoding on, written by [`make_expected.py`](make_expected.py). The parser tests compare every flash against it: id and quality exactly, latitude and longitude to six decimals, time within 1 ms. The reference unpacks times in float32 and truncates to whole milliseconds; the parser unpacks in float64 and rounds.

To add a fixture, download a file from `https://noaa-goes19.s3.amazonaws.com/GLM-L2-LCFA/<year>/<day-of-year>/<hour>/`, run `make_expected.py` on it, and commit both files. `.gitignore` allows `.nc` files only under `test/fixtures/`.
