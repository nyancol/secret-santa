import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(), // local user id (uuid)
  sub: text("sub").notNull().unique(), // OIDC subject
  displayName: text("display_name"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export type UserRow = typeof users.$inferSelect;
