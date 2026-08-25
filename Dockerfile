# syntax=docker/dockerfile:1

# ─── Go Build stage ─────────────────────────────────────────────────────────────
FROM golang:1.26-alpine AS builder

WORKDIR /src

# Cache dependency downloads
COPY go.mod go.sum ./
RUN go mod download

# Copy source and build both binaries
COPY . .
RUN CGO_ENABLED=0 go build -o /bin/server  ./cmd/server \
 && CGO_ENABLED=0 go build -o /bin/worker  ./cmd/worker

# ─── Server image ──────────────────────────────────────────────────────────────
FROM alpine:3.24 AS server
RUN apk add --no-cache ca-certificates
COPY --from=builder /bin/server /usr/local/bin/server
ENTRYPOINT ["server"]

# ─── Worker image ──────────────────────────────────────────────────────────────
FROM alpine:3.24 AS worker
RUN apk add --no-cache ca-certificates
COPY --from=builder /bin/worker /usr/local/bin/worker
ENTRYPOINT ["worker"]

# ─── Frontend Build stage ──────────────────────────────────────────────────────
FROM node:25-alpine AS frontend-builder
WORKDIR /app
COPY frontend/package*.json ./frontend/
WORKDIR /app/frontend
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ─── Docs Build stage ──────────────────────────────────────────────────────────
FROM node:25-alpine AS docs-builder
WORKDIR /app/docs-site
COPY docs-site/package*.json ./
RUN npm ci
COPY docs-site/ ./
RUN npm run build

# ─── Frontend image ────────────────────────────────────────────────────────────
FROM nginx:alpine AS frontend
COPY --from=frontend-builder /app/frontend/dist /usr/share/nginx/html
# The docs are built with base=/docs and served from the same origin as the app,
# so the landing page links to them without a second deployment or any CORS.
COPY --from=docs-builder /app/docs-site/dist /usr/share/nginx/html/docs
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
