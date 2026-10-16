# syntax=docker/dockerfile:1

# Build the server (tsc) and the client (Vite).
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.server.json vite.config.ts ./
COPY src ./src
RUN npm run build

# Runtime: production dependencies, the build output and the brand files. No state on disk.
FROM node:24-slim
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY assets ./assets
USER node
EXPOSE 8080
CMD ["node", "dist/server/index.js"]
