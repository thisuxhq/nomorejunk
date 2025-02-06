import { db } from "../db/db";
import { auditLogsTable } from "../db/schema";

export const logAudit = async (email: string, domain: string, ip: string, action: string) => {
  await db.insert(auditLogsTable).values({
    id: crypto.randomUUID(),
    email,
    domain,
    action,
    ip,
  });
};

// output: sample
// {
//   email: "test@gmail.com",
//   domain: "gmail.com",
//   action: "blocked",
//   ip: "127.0.0.1",
//   timestamp: "2025-02-05T12:00:00Z"
// }
