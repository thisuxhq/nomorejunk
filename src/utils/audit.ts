import { db } from "../db/db";
import { auditLogs } from "../db/schema";

export const logAudit = async (email: string, domain: string, ip: string, action: string) => {
  await db.insert(auditLogs).values({
    id: crypto.randomUUID(),
    email,
    domain,
    action,
    ip,
  });
};
