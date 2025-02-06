import { pgTable, text, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { nanoid } from "nanoid";

export const domainListTypeEnum = pgEnum('domain_list_type', ['disposable', 'allowlist']);

export const domainListsTable = pgTable("domain_lists", {
  id: text("id").$defaultFn(()=>nanoid(6)).primaryKey(),
  domain: text("domain").notNull().unique(),
  type: domainListTypeEnum("type").notNull(),
  created_at: timestamp("created_at").defaultNow(),
});

export const auditLogsTable = pgTable("audit_logs", {
  id: text("id").$defaultFn(()=>nanoid(6)).primaryKey(),
  email: text("email").notNull(),
  domain: text("domain").notNull(),
  action: text("action").notNull(),
  ip: text("ip"),
  timestamp: timestamp("timestamp").defaultNow(),
});

export type SelectDomainListsTable = typeof domainListsTable.$inferSelect;
export type SelectauditLogsTable = typeof auditLogsTable.$inferSelect;

export type InsertDomainListsTable = typeof domainListsTable.$inferInsert;
export type InsertauditLogsTable = typeof auditLogsTable.$inferInsert;
