# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

- OIDC/PocketID session auth (`src/auth`: login, callback, `GET /api/auth/me`, session gate on `/api/v1/*`, dev-only stub login) with SQLite users store (`src/db`: drizzle + better-sqlite3, `__migrations`-tracked, additive-only).
- SQLite backup/restore runbook (`.agents/skills/ops-data`): nightly zerobyte snapshots of prod data, restores only on explicit order.

## [0.1.0] - 2026-11-27

### Added

- Minimal hello-world Fastify API (`GET /`, `GET /api/health`) with OTEL telemetry (endpoint-gated, health-span filter).
- DevOps shape ported from `1001-restaurants`: mise, Dockerfile, compose prod/preprod (Caddy + telemetry networks), betterleaks hooks, self-hosted CI/SAST/release/preprod-preview workflows, openspec + opencode + firecrawl + stitch setup.
