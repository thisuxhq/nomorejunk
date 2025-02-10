import "dotenv/config";
import { redis } from "@/cache";
import { db } from "@/db/db";
import { domainListsTable, type InsertDomainListsTable, DomainType } from "@/db/schema";
import { eq } from "drizzle-orm";
import "dotenv/config";

// Fetch and update blocklist/allowlist data from GitHub
export async function syncDomainsFromGitHub() {
  try {
    // Get blocklist
    const BLOCKLIST_URL = process.env.BLOCKLIST_URL!;
    const blocklistResponse = await fetch(BLOCKLIST_URL);
    const blocklistText = await blocklistResponse.text();
    const blocklistDomains = blocklistText.split("\n").filter(Boolean);

    // Get allowlist
    const ALLOWLIST_URL = process.env.ALLOWLIST_URL!;
    const allowlistResponse = await fetch(ALLOWLIST_URL);
    const allowlistText = await allowlistResponse.text();
    const allowlistDomains = allowlistText.split("\n").filter(Boolean);

    // Clear existing domains
    await db.delete(domainListsTable);

    // Update the blocklist in the database
    const blocklistData: InsertDomainListsTable[] = blocklistDomains.map(
      (domain) => ({
        domain: domain.trim().toLowerCase(),
        type: 'disposable' as DomainType,
      })
    );

    for (let i = 0; i < blocklistData.length; i += 1000) {
      const batch = blocklistData.slice(i, i + 1000);
      await db.insert(domainListsTable).values(batch);
    }
    // Update the allowlist in the database
    const allowlistData: InsertDomainListsTable[] = allowlistDomains.map(
      (domain) => ({
        domain: domain.trim().toLowerCase(),
        type: "allowlist" as const,
      })
    );

    for (let i = 0; i < allowlistData.length; i += 1000) {
      const batch = allowlistData.slice(i, i + 1000);
      await db.insert(domainListsTable).values(batch);
    }

    // Refresh the Redis cache
    const [updatedBlocklist, updatedAllowlist] = await Promise.all([
      db
        .select()
        .from(domainListsTable)
        .where(eq(domainListsTable.type, "disposable")),
      db
        .select()
        .from(domainListsTable)
        .where(eq(domainListsTable.type, "allowlist")),
    ]);

    for (const item of updatedBlocklist) {
      await redis.set(
        `check-email:${item.domain}`,
        JSON.stringify({
          status: "blocked",
          disposable: true,
          reason: "This email domain is not allowed",
          domain: item.domain,
          message:
            "Please use a different email address from a trusted provider",
        }),
        "EX",
        86400
      );
    }

    for (const item of updatedAllowlist) {
      await redis.set(
        `check-email:${item.domain}`,
        JSON.stringify({
          status: "success",
          disposable: false,
          reason: "Domain allowlisted",
          domain: item.domain,
          message: "Email address is valid and safe to use",
        }),
        "EX",
        86400
      );
    }

    console.log("Successfully synced domains from GitHub.");
  } catch (error) {
    console.error("Error syncing domains:", error);
    throw error;
  }
}
