import "dotenv/config";
import { redis } from "@/cache";
import { db } from "@/db/db";
import { domainListsTable, type InsertDomainListsTable, DomainType } from "@/db/schema";

const BATCH_SIZE = 5000;

interface DomainCacheData {
  status: "blocked" | "success";
  disposable: boolean;
  reason: string;
  domain: string;
  message: string;
}

async function fetchDomainList(url: string): Promise<string[]> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch domain list: ${response.statusText}`);
  }
  const text = await response.text();
  return text.split("\n").filter(Boolean).map(domain => domain.trim().toLowerCase());
}

async function batchInsertDomains(domains: InsertDomainListsTable[]) {
  for (let i = 0; i < domains.length; i += BATCH_SIZE) {
    const batch = domains.slice(i, i + BATCH_SIZE);
    await db.insert(domainListsTable).values(batch);
  }
}

async function updateRedisCache(domains: { domain: string; type: DomainType }[]) {
  const pipeline = redis.pipeline();
  
  for (const { domain, type } of domains) {
    const cacheData: DomainCacheData = type === 'disposable' 
      ? {
          status: "blocked",
          disposable: true,
          reason: "This email domain is not allowed",
          domain,
          message: "Please use a different email address from a trusted provider"
        }
      : {
          status: "success",
          disposable: false,
          reason: "Domain allowlisted",
          domain,
          message: "Email address is valid and safe to use"
        };

    pipeline.set(
      `check-email:${domain}`,
      JSON.stringify(cacheData),
      "EX",
      86400 // 1 day
    );
  }

  await pipeline.exec();
}

export async function syncDomainsFromGitHub() {
  const BLOCKLIST_URL = process.env.BLOCKLIST_URL;
  const ALLOWLIST_URL = process.env.ALLOWLIST_URL;

  if (!BLOCKLIST_URL || !ALLOWLIST_URL) {
    throw new Error("Missing required environment variables");
  }

  try {
    // Fetch both lists in parallel
    const [blocklistDomains, allowlistDomains] = await Promise.all([
      fetchDomainList(BLOCKLIST_URL),
      fetchDomainList(ALLOWLIST_URL)
    ]);

    // Clear existing domains
    await db.delete(domainListsTable);

    // Prepare domain data
    const blocklistData: InsertDomainListsTable[] = blocklistDomains.map(domain => ({
      domain,
      type: 'disposable' as DomainType
    }));

    const allowlistData: InsertDomainListsTable[] = allowlistDomains.map(domain => ({
      domain,
      type: "allowlist" as DomainType
    }));

    // Insert domains in batches
    await Promise.all([
      batchInsertDomains(blocklistData),
      batchInsertDomains(allowlistData)
    ]);

    // Update Redis cache
    const allDomains = [
      ...blocklistData.map(d => ({ domain: d.domain, type: d.type })),
      ...allowlistData.map(d => ({ domain: d.domain, type: d.type }))
    ];

    await updateRedisCache(allDomains);

    console.log(`Successfully synced ${allDomains.length} domains from GitHub`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error("Error syncing domains:", errorMessage);
    throw error;
  }
}
