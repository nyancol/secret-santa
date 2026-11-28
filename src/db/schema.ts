import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(), // local user id (uuid)
  sub: text("sub").notNull().unique(), // OIDC subject
  displayName: text("display_name"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type UserRow = typeof users.$inferSelect;

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  signupDeadline: text("signup_deadline"),
  drawDate: text("draw_date"),
  giftDate: text("gift_date"),
  budgetAmount: real("budget_amount").notNull(),
  budgetCurrency: text("budget_currency").notNull(),
  organiserId: text("organiser_id").notNull(),
  status: text("status").notNull().default("draft"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type EventRow = typeof events.$inferSelect;

export const eventParticipants = sqliteTable("event_participants", {
  eventId: text("event_id").notNull(),
  userId: text("user_id").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const eventExclusions = sqliteTable("event_exclusions", {
  eventId: text("event_id").notNull(),
  giverId: text("giver_id").notNull(),
  recipientId: text("recipient_id").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const eventAssignments = sqliteTable("event_assignments", {
  eventId: text("event_id").notNull(),
  giverId: text("giver_id").notNull(),
  recipientId: text("recipient_id").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const participantProfiles = sqliteTable("participant_profiles", {
  eventId: text("event_id").notNull(),
  userId: text("user_id").notNull(),
  recipientName: text("recipient_name"),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  postalCode: text("postal_code"),
  country: text("country"),
  phone: text("phone"),
  notes: text("notes"),
  updatedAt: integer("updated_at").notNull(),
});

export const wishlistItems = sqliteTable("wishlist_items", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull(),
  userId: text("user_id").notNull(),
  label: text("label").notNull(),
  url: text("url"),
  priceHint: text("price_hint"),
  priority: integer("priority"),
  position: integer("position").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type WishlistItemRow = typeof wishlistItems.$inferSelect;
