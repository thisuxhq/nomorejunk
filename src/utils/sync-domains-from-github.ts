import "dotenv/config";
import { redis } from "@/cache";
import { db } from "@/db/db";
import {  domainListsTable, type InsertDomainListsTable } from "@/db/schema";
import { eq } from "drizzle-orm";

// Fetch and update blocklist/allowlist data from GitHub
export async function syncDomainsFromGitHub() {
  try {

    const blocklistResponse = await fetch("https://raw.githubusercontent.com/martenson/disposable-email-domains/master/disposable_email_blocklist.conf");
    console.log("blocklistResponse", blocklistResponse);
    
    const blocklistText = await blocklistResponse.text();
    const blocklistDomains = blocklistText.split("\n").filter(Boolean);

    const allowlistResponse = await fetch("https://raw.githubusercontent.com/martenson/disposable-email-domains/master/allowlist.conf");
    
    const allowlistText = await allowlistResponse.text();
    const allowlistDomainsString = allowlistText.split("\n").filter(Boolean);

    // Clear existing domains
    await db.delete( domainListsTable);

    // Update the blocklist in the database
    const blocklistData: InsertDomainListsTable[] = blocklistDomains.map((domain) => ({
      domain: domain.trim().toLowerCase(),
      type: "disposable" as const,
    }));

    for (let i = 0; i < blocklistData.length; i += 1000) {
      const batch = blocklistData.slice(i, i + 1000);
      await db.insert( domainListsTable).values(batch);
    }
    // Update the allowlist in the database
    const allowlistData: InsertDomainListsTable[] = allowlistDomainsString.map((domain) => ({
      domain: domain.trim().toLowerCase(),
      type: "allowlist" as const,
    }));

    for (let i = 0; i < allowlistData.length; i += 1000) {
      const batch = allowlistData.slice(i, i + 1000);
      await db.insert( domainListsTable).values(batch);
    }

    // Refresh the Redis cache
    const [updatedBlocklist, updatedAllowlist] = await Promise.all([
      db.select().from( domainListsTable).where(eq(domainListsTable.type, "disposable")),
      db.select().from(domainListsTable).where(eq(domainListsTable.type, "allowlist")),
    ]);

    await redis.set("blocklist", JSON.stringify(updatedBlocklist));
    await redis.set("allowlist", JSON.stringify(updatedAllowlist));

    console.log("Successfully synced domains from GitHub.");
  } catch (error) {
    console.error("Error syncing domains:", error);
    throw error;
  }
}
