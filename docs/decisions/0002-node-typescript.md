# Node and TypeScript

BoltClock is written in TypeScript and runs on Node 24 LTS. The server uses Fastify. The browser client is built with Vite and uses no framework. Vitest tests both sides. GLM files are read with `h5wasm`.

Most of the app runs in the browser: the location picker, distance filtering, the state machine, the countdown, audio and rendering. That code is TypeScript whatever the server language is. Writing the server in TypeScript as well gives one toolchain, one test runner and one linter, and lets the flash, heartbeat and weather messages be typed once for both sides. The server's own work is input and output: it polls a bucket listing every few seconds, reads a small file, holds push connections open and relays weather requests. Node handles that well in a small container.

GLM-L2-LCFA files are NetCDF4, which is HDF5. `h5wasm` is the HDF5 C library compiled to WebAssembly, so it reads the files as faithfully as the native library does. It does not apply the CF conventions that `xarray` applies, so the parser unpacks the packed variables itself (`scale_factor`, `add_offset`, `_Unsigned`). The parser is tested against a real GOES-19 file, with expected values produced once by `xarray` outside the app.

The container is one image: the Node server serves the built client, the push channel and the weather relay on one port.

Python with FastAPI has the most mature NetCDF tools and would also work. It would mean a second language next to the TypeScript client and a larger image, which a flash-within-radius check does not justify. Revisit it if BoltClock ever needs real scientific processing, such as gridded lightning products. .NET 10 fits the container well, but its HDF5 readers are less proven for these files. Go has no solid HDF5 reader.
