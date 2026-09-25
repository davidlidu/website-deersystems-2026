# ─── DeerSystems · imagen de producción ───────────────────────────────
# Etapa 1: compila el sitio estático con Node.
# Etapa 2: lo sirve con Nginx (imagen final liviana, sin Node).

# Imágenes base configurables (p. ej. public.ecr.aws/docker/library/node:22-alpine
# si Docker Hub limita las descargas en tu servidor).
ARG NODE_IMAGE=node:22-alpine
ARG NGINX_IMAGE=nginx:1.27-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /app

# Dependencias primero para aprovechar la caché de Docker.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# ──────────────────────────────────────────────────────────────────────
FROM ${NGINX_IMAGE}

COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
