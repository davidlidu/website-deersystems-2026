# 1) Compila la app de partners (React + Vite) a public/partners.
FROM node:24-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY web ./web
RUN npm run build:web

# 2) Imagen final: solo Node y dependencias de producción. El servidor ejecuta el TypeScript directamente.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public
COPY --from=web /app/public/partners ./public/partners

# La base SQLite y los archivos de las propuestas viven en /data: móntalo como volumen.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.ts"]
