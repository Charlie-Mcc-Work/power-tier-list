# Build the frontend (Vite, base: /)
FROM node:20-slim AS frontend
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts vitest.config.ts eslint.config.js index.html ./
COPY public ./public
COPY src ./src
RUN npm run build:selfhost

# Run the Express server, which serves both the API and the built frontend
FROM node:20-slim
WORKDIR /app

# Install only server dependencies
COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev

# Copy server source and built frontend
COPY server/index.js ./
COPY --from=frontend /build/dist ./public

RUN mkdir -p /data
ENV DATA_DIR=/data
ENV PUBLIC_DIR=/app/public
EXPOSE 3001

CMD ["node", "index.js"]
