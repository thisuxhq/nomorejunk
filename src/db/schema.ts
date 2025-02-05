import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const disposableDomains = pgTable("disposable_domains", {
  id: text("id").primaryKey(),
  domain: text("domain").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const allowlistDomains = pgTable("allowlist_domains", {
  id: text("id").primaryKey(),
  domain: text("domain").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const auditLogs = pgTable("audit_logs", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  domain: text("domain").notNull(),
  action: text("action").notNull(),
  ip: text("ip"),
  timestamp: timestamp("timestamp").defaultNow(),
});
