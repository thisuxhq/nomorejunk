import { Hono } from "hono";
import { db } from "@/db/db";
import { disposableDomains, allowlistDomains, auditLogs } from "@/db/schema";
import { normalizeEmail, createDomainMatcher } from "@/utils";
import { redis } from "@/cache";
import { eq } from "drizzle-orm";
import { logAudit } from "@/utils/audit";
import { syncDomainsFromGitHub } from "@/utils/sync-domains-from-github";

const app = new Hono();

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

// Sync Domains from GitHub
app.get("/sync-domains", async (c) => {
  try {
    await syncDomainsFromGitHub();
    return c.json({ success: true });
  } catch (error) {
    console.error("Error syncing domains from GitHub:", error);
    return c.json({ error: "Failed to sync domains" }, 500);
  }
});

// 1. Check if Email is Disposable
// Check email endpoint with Redis caching
app.post("/check-email", async (c) => {
  const { email } = await c.req.json();
  const ip = c.req.header("x-forwarded-for") || c.req.ip;
  const normalizedEmail = normalizeEmail(email);
  const domain = normalizedEmail.split("@")[1];

  // Check Redis cache first
  const cachedResult = await redis.get(`check-email:${domain}`);
  if (cachedResult) {
    return c.json(JSON.parse(cachedResult));
  }

  // Check allowlist
  const allowlist = await db
    .select()
    .from(allowlistDomains)
    .where(eq(allowlistDomains.domain, domain));
  if (allowlist.length > 0) {
    const result = { disposable: false, reason: "Allowlisted" };
    // Cache result for 1 day (86400 seconds)
    await redis.set(`check-email:${domain}`, JSON.stringify(result), 'EX', 86400);
    return c.json(result);
  }

  // Check blocklist
  const blocklist = await db
    .select()
    .from(disposableDomains)
    .where(eq(disposableDomains.domain, domain));
  if (blocklist.length > 0) {
    await logAudit(email, domain, ip, "blocked");
    const result = { disposable: true, reason: "Blocklisted" };
    // Cache result for 1 day (86400 seconds)
    await redis.set(`check-email:${domain}`, JSON.stringify(result), 'EX', 86400);
    return c.json(result);
  }

  // Fetch domain lists for matching
  const disposableDomainsList = await db
    .select({ domain: disposableDomains.domain })
    .from(disposableDomains);

  // Create domain matcher which will be used to check domain similarity ex: gmail.com vs gmaill.com, yahoomail.com, etc.
  const domainMatcher = createDomainMatcher(
    disposableDomainsList.map((d) => d.domain),
  );

  // Check domain similarity
  const isSimilar = domainMatcher.match(domain);
  if (isSimilar) {
    await logAudit(email, domain, ip, "blocked_similarity");
    const result = {
      disposable: true,
      reason: "Similar to known disposable domains",
    };
    // Cache result for 1 day (86400 seconds)
    await redis.set(`check-email:${domain}`, JSON.stringify(result), 'EX', 86400);
    return c.json(result);
  }

  await logAudit(email, domain, ip, "verified");
  const result = { disposable: false };
  // Cache result for 1 day (86400 seconds)
  await redis.set(`check-email:${domain}`, JSON.stringify(result), 'EX', 86400);
  return c.json(result);
});

// 2. Verify if Email is Disposable (new endpoint)
app.post("/verify-email", async (c) => {
  const { email } = await c.req.json();
  const ip = c.req.header("x-forwarded-for");
  const normalizedEmail = normalizeEmail(email);
  const domain = normalizedEmail.split("@")[1];

  // Check Redis cache first
  const cachedBlocklist = await redis.get("blocklist");
  const cachedAllowlist = await redis.get("allowlist");

  const blocklistDomains = cachedBlocklist ? JSON.parse(cachedBlocklist) : [];
  const allowlistDomains = cachedAllowlist ? JSON.parse(cachedAllowlist) : [];

  // Check allowlist
  if (allowlistDomains.includes(domain)) {
    return c.json({ disposable: false, reason: "Allowlisted" });
  }

  // Check blocklist
  if (blocklistDomains.includes(domain)) {
    await logAudit(email, domain, ip, "blocked");
    return c.json({ disposable: true, reason: "Blocklisted" });
  }

  // If not found in cache, check database as fallback
  const allowlistDb = await db
    .select()
    .from(allowlistDomains)
    .where(eq(allowlistDomains.domain, domain));
  if (allowlistDb.length > 0) {
    return c.json({ disposable: false, reason: "Allowlisted" });
  }

  const blocklistDb = await db
    .select()
    .from(disposableDomains)
    .where(eq(disposableDomains.domain, domain));
  if (blocklistDb.length > 0) {
    await logAudit(email, domain, ip, "blocked");
    return c.json({ disposable: true, reason: "Blocklisted" });
  }

  // Default if not disposable
  await logAudit(email, domain, ip, "verified");
  return c.json({ disposable: false });
});

// 3. Add to Blocklist
app.post("/blocklist", async (c) => {
  const { domain } = await c.req.json();
  await db
    .insert(disposableDomains)
    .values({ id: crypto.randomUUID(), domain });
  return c.json({ success: true, domain });
});

// 4. Add to Allowlist
app.post("/allowlist", async (c) => {
  const { domain } = await c.req.json();
  await db.insert(allowlistDomains).values({ id: crypto.randomUUID(), domain });
  return c.json({ success: true, domain });
});

// 5. Get All Domains (with pagination)
app.get("/domains", async (c) => {
  const { type, page = 1, limit = 10 } = c.req.query();
  const offset = (Number(page) - 1) * Number(limit);

  const query =
    type === "blocklist"
      ? db.select().from(disposableDomains).offset(offset).limit(Number(limit))
      : type === "allowlist"
        ? db.select().from(allowlistDomains).offset(offset).limit(Number(limit))
        : null;

  if (!query) return c.json({ error: "Invalid domain type" }, 400);

  const domains = await query;
  return c.json({ domains });
});

// 6. Remove Domain
app.delete("/remove-domain", async (c) => {
  const { domain, type } = await c.req.json();

  const table =
    type === "blocklist"
      ? disposableDomains
      : type === "allowlist"
        ? allowlistDomains
        : null;
  if (!table) return c.json({ error: "Invalid domain type" }, 400);

  await db.delete(table).where(eq(table.domain, domain));
  return c.json({ success: true });
});

// 7. Refresh Cache
app.post("/refresh-cache", async (c) => {
  const blocklist = await db.select().from(disposableDomains);
  const allowlist = await db.select().from(allowlistDomains);

  await redis.set("blocklist", JSON.stringify(blocklist));
  await redis.set("allowlist", JSON.stringify(allowlist));

  return c.json({ success: true });
});

// 8. Get Audit Logs
app.get("/audit-logs", async (c) => {
  const logs = await db.select().from(auditLogs);
  return c.json({ logs });
});

// 9. Get Audit Logs (with pagination)
app.get("/audit-logs", async (c) => {
  const { page = 1, limit = 10 } = c.req.query();
  const offset = (Number(page) - 1) * Number(limit);
  const logs = await db
    .select()
    .from(auditLogs)
    .offset(offset)
    .limit(Number(limit));
  return c.json({ logs });
});

// 10. Get Audit Logs by Email
app.get("/audit-logs/:email", async (c) => {
  const { email } = c.req.param();
  const logs = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.email, email));
  return c.json({ logs });
});



export default app;
