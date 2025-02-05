import "dotenv/config";
import { redis } from "@/cache";
import { db } from "@/db/db";
import { disposableDomains, allowlistDomains } from "@/db/schema";

// Fetch and update blocklist/allowlist data from GitHub
export async function syncDomainsFromGitHub() {
  try {
    // Fetch the blocklist
    const blocklistResponse = await fetch(process.env.BLOCKLIST_URL!);
    const blocklistText = await blocklistResponse.text();
    const blocklistDomains = blocklistText.split("\n").filter(Boolean);

    // Fetch the allowlist
    const allowlistResponse = await fetch(process.env.ALLOWLIST_URL!);
    const allowlistText = await allowlistResponse.text();
    const allowlistDomainsString = allowlistText.split("\n").filter(Boolean);

    // Clear existing domains
    await db.delete(disposableDomains);
    await db.delete(allowlistDomains);

    // Update the blocklist in the database
    const blocklistData = blocklistDomains.map((domain) => ({
      id: crypto.randomUUID(),
      domain: domain.trim().toLowerCase(),
    }));

    for (let i = 0; i < blocklistData.length; i += 1000) {
      const batch = blocklistData.slice(i, i + 1000);
      await db.insert(disposableDomains).values(batch);
    }

    // Update the allowlist in the database
    const allowlistData = allowlistDomainsString.map((domain) => ({
      id: crypto.randomUUID(),
      domain: domain.trim().toLowerCase(),
    }));

    for (let i = 0; i < allowlistData.length; i += 1000) {
      const batch = allowlistData.slice(i, i + 1000);
      await db.insert(allowlistDomains).values(batch);
    }

    // Refresh the Redis cache
    const [updatedBlocklist, updatedAllowlist] = await Promise.all([
      db.select().from(disposableDomains),
      db.select().from(allowlistDomains),
    ]);

    await redis.set("blocklist", JSON.stringify(updatedBlocklist));
    await redis.set("allowlist", JSON.stringify(updatedAllowlist));

    console.log("Successfully synced domains from GitHub.");
  } catch (error) {
    console.error("Error syncing domains:", error);
    throw error;
  }
}
