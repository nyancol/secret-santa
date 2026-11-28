# Spec Delta

## Purpose

Lets each participant maintain their own shipping profile and wishlist per event and browse the participant directory without ever exposing assignments.

## ADDED Requirements

### Requirement: Own profile and address form

The UI SHALL render an own-profile form per event and persist it via `PUT .../profile` upsert.

#### Scenario: Save profile

- **WHEN** the user edits recipient, address lines, city, postal code, country, phone, or notes and saves
- **THEN** the UI PUTs the fields and shows the saved state on success.

#### Scenario: Profile save validation error

- **WHEN** the backend returns 422
- **THEN** the UI shows an inline error and preserves the typed values.

### Requirement: Own wishlist CRUD

The UI SHALL list, add, edit, and delete the caller's own wishlist items for the event.

#### Scenario: Add item

- **WHEN** the user submits a label (plus optional url, priceHint, priority)
- **THEN** the UI POSTs to `.../wishlist` and appends the returned item on 201.

#### Scenario: Edit item

- **WHEN** the user edits an item and PATCH succeeds
- **THEN** the UI shows the updated values.

#### Scenario: Delete item

- **WHEN** the user deletes an item and DELETE succeeds
- **THEN** the UI removes it from the list.

### Requirement: Wishlist reorder

The UI SHALL let the user reorder their own wishlist via the `position` field.

#### Scenario: Move item

- **WHEN** the user moves an item to a new position and PATCH `position` succeeds
- **THEN** the UI renders the new order returned by the list endpoint.

### Requirement: Participant directory without assignments

The UI SHALL render the participant directory from `GET .../participants` showing profiles and wishlists only.

#### Scenario: Directory loads

- **WHEN** a member opens the directory section of an event
- **THEN** the UI shows each participant's displayName, profile fields, and ordered wishlist items.

#### Scenario: No assignment data rendered

- **WHEN** the directory is displayed
- **THEN** no giver/recipient assignment mapping appears anywhere in the view (the endpoint returns none and the UI requests no assignment resource).
