# Spec Delta

## Purpose

Retire the placeholder root greeting now that the minimal UI owns `/`.

## REMOVED Requirements

### Requirement: Root greeting
The system SHALL NO LONGER respond to `GET /` with the `{ hello: "world", ... }` JSON body; `GET /` serves the UI entry point instead. `GET /api/health` is unchanged.
