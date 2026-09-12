# Build the static bundle, then serve it from nginx.
#
# The app has no backend by design - your location history is parsed in the
# browser and never leaves it - so the runtime image is just a static file server.
#
# public/data/*.json is committed, so the build is hermetic and needs no network
# beyond npm. To refresh the zone boundaries from the councils' feeds, run
# `npm run data:zones` on the host and rebuild the image.

# ---------------------------------------------------------------- builder --
FROM node:22-alpine AS builder
WORKDIR /app

# Copy manifests first so the dependency layer caches across source edits.
COPY package.json package-lock.json* ./
RUN npm ci || npm install

COPY . .

# The default base path targets GitHub Pages, which serves this repo from
# /carsearch/. nginx here serves it from the root, so override it.
ENV BASE_PATH=/
RUN npm run build

# ---------------------------------------------------------------- runtime --
FROM nginx:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

# nginx:alpine ships a non-root 'nginx' user; the stock image entrypoint handles
# the permissions it needs on /var/cache/nginx.
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
