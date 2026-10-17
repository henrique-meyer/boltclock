"""Reference read of a GLM-L2-LCFA file with xarray (CF decoding on), for the parser tests.

    python -m venv .venv && .venv/bin/pip install netCDF4 xarray numpy
    .venv/bin/python make_expected.py <file>.nc <file>.expected.json

Writes the coverage window and every flash (id, first-event time in UTC ms, lat, lon,
quality flag) exactly as xarray decodes them. It is independent of BoltClock's h5wasm
parser, which applies the same CF rules by hand.
"""
import json
import sys

import numpy as np
import xarray as xr

src, out = sys.argv[1], sys.argv[2]
ds = xr.open_dataset(src, decode_times=True, mask_and_scale=True)

result = {
    "source": src.replace("\\", "/").split("/")[-1],
    "reader": f"xarray {xr.__version__}",
    "start": ds.attrs["time_coverage_start"],
    "end": ds.attrs["time_coverage_end"],
    "flashCount": int(ds.sizes["number_of_flashes"]),
    "flashes": [
        {
            "id": int(i),
            "timeMs": int(np.datetime64(t, "ns").astype("int64") // 1_000_000),
            "lat": float(la),
            "lon": float(lo),
            "quality": int(q),
        }
        for i, t, la, lo, q in zip(
            ds["flash_id"].values,
            ds["flash_time_offset_of_first_event"].values,
            ds["flash_lat"].values,
            ds["flash_lon"].values,
            ds["flash_quality_flag"].values,
        )
    ],
}
with open(out, "w", encoding="utf-8") as f:
    json.dump(result, f, indent=1)
print(result["source"], "flashes:", result["flashCount"])
