# Hosted front-end image (Accounts A5): the built single-page app served by nginx on the internal network only.
# The proxy (Caddy) adds the response headers; nginx serves files and nothing else.
# Build context is ../frontend; the nginx file comes from the named context "hosted" (see build-images.sh).
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY --from=hosted nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
