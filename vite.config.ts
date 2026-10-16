import { defineConfig } from 'vite';

// The client lives in src/client. `npm run dev` starts Vite on 5173 and the Fastify server on 8080;
// Vite forwards the server's routes there. `npm run build` writes the client to dist/client, which the server serves.
const server = 'http://localhost:8080';

export default defineConfig({
  root: 'src/client',
  publicDir: false,
  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
    // /assets/ is the brand folder, served by the server. Vite's bundles go under /static/.
    assetsDir: 'static',
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/health': server,
      '/api': server,
      '/events': server,
      '/assets': server,
    },
  },
});
