import { db } from "@/db/db";
import { auditLogsTable } from "@/db/schema";


export async function logAudit(
  email: string,
  domain: string,
  ip: string,
  action: string
): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      email,
      domain,
      action,
      ip,
    });
  } catch (error) {
    console.error("Error logging audit:", error);
    throw error;
  }
};

