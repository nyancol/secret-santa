# Spec Delta

## Purpose

Participant customization and directory for Secret Santa events: each member
maintains their own shipping info and wishlist, and every member can browse the
profiles, wishlists, and addresses of all fellow participants.

## ADDED Requirements

### Requirement: Own shipping info
The system SHALL let each participant create or replace their own per-event
shipping info (`recipientName`, `addressLine1`, `addressLine2`, `city`,
`postalCode`, `country`, `phone`, `notes`) via PUT; users SHALL NOT edit
another participant's info.

#### Scenario: Set own shipping info
- **WHEN** a participant PUTs `/api/v1/events/:id/profile` with a valid address
- **THEN** the response is 200 with the stored profile.

#### Scenario: Edit another profile forbidden
- **WHEN** user A attempts to write user B's profile
- **THEN** the response is 403 and B's profile is unchanged.

#### Scenario: Outsider profile write blocked
- **WHEN** a non-participant PUTs a profile for the event
- **THEN** the response is 403.

### Requirement: Own wishlist
The system SHALL let each participant manage their own ordered wishlist items
(`label` required, `url`, `priceHint`, `priority`) with add, update/reorder via
`PATCH /api/v1/events/:id/wishlist/:itemId`, and delete; users SHALL NOT modify
another participant's items.

#### Scenario: Add wishlist item
- **WHEN** a participant POSTs `/api/v1/events/:id/wishlist` with a label
- **THEN** the response is 201 with the item including its position.

#### Scenario: Update wishlist item
- **WHEN** a participant PATCHes their own item (label/url/priceHint/priority/position)
- **THEN** the response is 200 with the updated item and siblings reordered if position changed.

#### Scenario: Delete wishlist item
- **WHEN** a participant DELETEs their own item
- **THEN** the response is 200 and the item is removed with siblings reordered.

#### Scenario: Cross-user wishlist write forbidden
- **WHEN** user A POSTs or DELETEs on user B's wishlist
- **THEN** the response is 403.

### Requirement: Participant directory
The system SHALL let the organiser and participants list all participants of
an event with each member's display name, shipping info, and wishlist;
outsiders SHALL be denied.

#### Scenario: Member browses directory
- **WHEN** a participant GETs `/api/v1/events/:id/participants`
- **THEN** the response is 200 with every participant's profile and wishlist.

#### Scenario: Outsider directory blocked
- **WHEN** a non-member GETs the participant list
- **THEN** the response is 403.

### Requirement: Wishlist visibility respects draw privacy
The system SHALL include wishlists and profiles in the directory without ever
exposing assignment edges; directory responses SHALL NOT contain `giftee` or
`giver` fields.

#### Scenario: No assignment leak in directory
- **WHEN** a participant fetches the directory on a `drawn` event
- **THEN** the response contains profiles and wishlists but no assignment data.
