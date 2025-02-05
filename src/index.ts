import { Hono } from "hono";
import { db } from "@/db/db";
import { domainListsTable, auditLogsTable } from "@/db/schema";
import { normalizeEmail, createDomainMatcher } from "@/utils";
import { redis } from "@/cache";
import { eq, and, desc } from "drizzle-orm";
import { logAudit } from "@/utils/audit";
import { syncDomainsFromGitHub } from "@/utils/sync-domains-from-github";
import { authMiddleware } from "./middleware/auth";

const app = new Hono().basePath("/api.nomorejunk.com")

app.get("/", (c) => {
  return c.text("Hello Hono!");
});

// Sync Domains from GitHub
app.get("/sync-domains",authMiddleware, async (c) => {
  try {
    const startTime = new Date();
    await syncDomainsFromGitHub();
    
    return c.json({
      status: "success",
      message: "Domain lists successfully synchronized from GitHub",
      details: {
        source: "GitHub disposable-email-domains repository",
        syncedAt: startTime.toISOString(),
        duration: `${new Date().getTime() - startTime.getTime()}ms`
      },
      timestamp: new Date().toISOString()
    }, 200);

  } catch (error) {
    return c.json({
      status: "error",
      message: "Failed to sync domains from GitHub",
      error: (error as Error).message,
      timestamp: new Date().toISOString()
    }, 500);
  }
});

// 1. Check if Email is Disposable
// Check email endpoint with Redis caching
// app.post("/check-email", async (c) => {
//   const { email } = await c.req.json();
//   const ip = c.req.header("x-forwarded-for") || c.req.ip;
//   const normalizedEmail = normalizeEmail(email);
//   const domain = normalizedEmail.split("@")[1]; // gmail.com

//   // Check Redis cache first
//   const cachedResult = await redis.get(`check-email:${domain}`);
//   if (cachedResult) {
//     return c.json(JSON.parse(cachedResult));
//   }

//   // Check allowlist
//   const allowlist = await db
//     .select()
//     .from(domainListsTable)
//     .where(and(
//       eq(domainListsTable.domain, domain),
//       eq(domainListsTable.type, 'allowlist')
//     ));
//   if (allowlist.length > 0) {
//     const result = { disposable: false, reason: "Allowlisted" };
//     // Cache result for 1 day (86400 seconds)
//     await redis.set(`check-email:${domain}`, JSON.stringify(result), 'EX', 86400);
//     return c.json(result);
//   }

//   // Check blocklist
//   const blocklist = await db
//     .select()
//     .from(domainListsTable)
//     .where(and(
//       eq(domainListsTable.domain, domain),
//       eq(domainListsTable.type, 'disposable')
//     ));
//   if (blocklist.length > 0) {
//     await logAudit(email, domain, ip, "blocked");
//     const result = { disposable: true, reason: "Blocklisted" };
//     // Cache result for 1 day (86400 seconds)
//     await redis.set(`check-email:${domain}`, JSON.stringify(result), 'EX', 86400);
//     return c.json(result);
//   }

//   // Fetch domain lists for matching
//   const disposableDomainsList = await db
//     .select({ domain: domainListsTable.domain })
//     .from(domainListsTable)
//     .where(eq(domainListsTable.type, 'disposable'));

//   // Create domain matcher which will be used to check domain similarity ex: gmail.com vs gmaill.com, yahoomail.com, etc.
//   const domainMatcher = createDomainMatcher(
//     disposableDomainsList.map((d) => d.domain),
//   );

//   // Check domain similarity
//   const isSimilar = domainMatcher.match(domain);
//   if (isSimilar) {
//     await logAudit(email, domain, ip, "blocked_similarity");
//     const result = {
//       disposable: true,
//       reason: "Similar to known disposable domains",
//     };
//     // Cache result for 1 day (86400 seconds)
//     await redis.set(`check-email:${domain}`, JSON.stringify(result), 'EX', 86400);
//     return c.json(result);
//   }

//   await logAudit(email, domain, ip, "verified");
//   const result = { disposable: false };
//   // Cache result for 1 day (86400 seconds)
//   await redis.set(`check-email:${domain}`, JSON.stringify(result), 'EX', 86400);
//   return c.json(result);
// });

// 2. Verify if Email is Disposable (new endpoint)
app.post("/verify-email",authMiddleware,  async (c) => {

  // Get email from request body
  const { email } = await c.req.json();

  // Check if email is provided
  if(!email) {
    return c.json({ error: "Email is required" }, 400);
  }

  // Get IP address of the request
  const ip = c.req.header("x-forwarded-for") || "unknown";

  // Normalize email and extract domain
  const normalizedEmail = normalizeEmail(email);

  // Extract domain from email
  const domain = normalizedEmail.split("@")[1];

  const cachedResult = await redis.get(`check-email:${domain}`);
  if (cachedResult) {
    return c.json(JSON.parse(cachedResult));
  }

  const allowlistDb = await db
    .select()
    .from(domainListsTable)
    .where(and(
      eq(domainListsTable.domain, domain),
      eq(domainListsTable.type, 'allowlist')
    ));

  
  if (allowlistDb.length > 0) {
    await logAudit(email, domain, ip, "verified_allowlisted_db");
    try {

      const result = {
        status: "success",
        disposable: false,
        reason: "Domain allowlisted",
        domain: domain,
        message: "Email address is valid and safe to use"
      }

      await redis.set(`check-email:${domain}`, JSON.stringify(result), 'EX', 86400);
    }
    catch(error) {
      console.error("Redis cache update failed:", error);
      // Still return success even if cache update fails
      return c.json({
        status: "success",
        disposable: false,
        reason: "Domain allowlisted but cache update failed",
        domain: domain,
        message: "Email address is valid and safe to use"
      }, 200);
    }
    return c.json({
      status: "success",
      disposable: false,
      reason: "This email domain is trusted and allowlisted",
      domain: domain,
      message: "Email address is valid and safe to use"
    }, 200);
  }

  const blocklistDb = await db
    .select()
    .from(domainListsTable)
    .where(and(
      eq(domainListsTable.domain, domain),
      eq(domainListsTable.type, 'disposable')
    ));


  if (blocklistDb.length > 0) {
    await logAudit(email, domain, ip, "blocked_disposable_db");
    // Update Redis cache
    try
    {
      const result = {
        status: "blocked",
        disposable: true,
        reason: "This email domain is not allowed",
        domain: domain,
        message: "Please use a different email address from a trusted provider",
      }
      await redis.set(`check-email:${domain}`, JSON.stringify(result), 'EX', 86400);
    }
    catch(error) {
      console.error("Redis cache update failed:", error);
      // Still return blocked even if cache update fails
      return c.json({
        status: "blocked",
        disposable: true,
        reason: "This email domain is not allowed",
        domain: domain,
        message: "Please use a different email address from a trusted provider",
      }, 403);
    }


    const domainMatcher = createDomainMatcher(
      blocklistDb.map((d) => d.domain),
    );


    const isSimilar = domainMatcher.match(domain);
    if (isSimilar) {
      await logAudit(email, domain, ip, "blocked_similarity");
      const result = {
        status: "blocked",
        disposable: true,
        reason: "Similar to known disposable domains",
        domain: domain,
        message: "Please use a different email address from a trusted provider",
      };
      // Cache result for 1 day (86400 seconds)
      await redis.set(`check-email:${domain}`, JSON.stringify(result), 'EX', 86400);
      return c.json(result);
    }

    await logAudit(email, domain, ip, "verified_unknown");
    const result = {
      status: "success",
      disposable: false,
      reason: "Domain not found in any lists",
      domain: domain,
      message: "Email address appears to be valid"
    };
    // Cache result for 1 day (86400 seconds)
    await redis.set(`check-email:${domain}`, JSON.stringify(result), 'EX', 86400);
    return c.json(result);
  }
});




// 3. Add to Blocklist
app.post("/blocklist",authMiddleware,  async (c) => {
  try {
    const { domain } = await c.req.json();

    if (!domain) {
      return c.json({
        status: "error",
        message: "Domain is required",
        timestamp: new Date().toISOString()
      }, 400);
    }

    const normalizedDomain = domain.toLowerCase();
    const [existingDomain] = await db
      .select()
      .from(domainListsTable)
      .where(and(
        eq(domainListsTable.domain, normalizedDomain),
      ));
    
    if(existingDomain?.type === 'disposable') {
      return c.json({
        status: "error",
        message: "Domain already exists in blocklist",
        timestamp: new Date().toISOString()
      }, 400);
    }

    if(existingDomain?.type === 'allowlist') {
      await db
        .update(domainListsTable)
        .set({ type: 'disposable' })
        .where(eq(domainListsTable.domain, normalizedDomain));

      return c.json({
        status: "success",
        disposable: true,
        message: "Domain moved from allowlist to blocklist",
        domain: normalizedDomain,
      }, 200);
    }

    await db
      .insert(domainListsTable)
      .values({ domain: normalizedDomain, type: 'disposable' });

    return c.json({
      status: "success",
      message: "Domain added to blocklist",
      domain: normalizedDomain,
    }, 201);

  } catch(error) {
    return c.json({
      status: "error",
      message: "Failed to add domain to blocklist",
      error: (error as Error).message,
      timestamp: new Date().toISOString()
    }, 500);
  }
});

app.post("/allowlist",authMiddleware,  async (c) => {
  try {
    const { domain } = await c.req.json();

    if (!domain) {
      return c.json({
        status: "error",
        message: "Domain is required",
        timestamp: new Date().toISOString()
      }, 400);
    }

    const normalizedDomain = domain.toLowerCase();
    const [existingDomain] = await db
      .select()
      .from(domainListsTable)
      .where(and(
        eq(domainListsTable.domain, normalizedDomain),
      ));

    if(existingDomain?.type === 'allowlist') {
      return c.json({
        status: "error",
        message: "Domain already exists in allowlist",
      }, 400);
    }

    if(existingDomain?.type === 'disposable') {
      await db
        .update(domainListsTable)
        .set({ type: 'allowlist' })
        .where(eq(domainListsTable.domain, normalizedDomain));

      return c.json({
        status: "success",
        disposable: false,
        message: "Domain moved from blocklist to allowlist",
        domain: normalizedDomain,
      }, 200);
    }

    await db
      .insert(domainListsTable)
      .values({ domain: normalizedDomain, type: 'allowlist' });

    return c.json({
      status: "success",
      message: "Domain added to allowlist",
      domain: normalizedDomain,
      type: "allowlist",
    }, 201);

  } catch(error) {
    return c.json({
      status: "error",
      message: "Failed to add domain to allowlist",
      error: (error as Error).message,
    }, 500);
  }
});

// 5. Get All Domains (with pagination)
app.get("/domains",authMiddleware,  async (c) => {
  try {
    const { type, page = 1, limit = 10 } = c.req.query();
    const offset = (Number(page) - 1) * Number(limit);

    if (type !== 'disposable' && type !== 'allowlist') {
      return c.json({
        status: "error",
        message: "Invalid domain type. Must be 'disposable' or 'allowlist'",
        timestamp: new Date().toISOString()
      }, 400);
    }

    // Get domains for current page
    const domains = await db
      .select()
      .from(domainListsTable)
      .where(eq(domainListsTable.type, type))
      .offset(offset)
      .limit(Number(limit));

    return c.json({
      status: "success",
      message: `Successfully retrieved ${type} domains`,
      domains,
    }, 200);
  } catch (error) {
    return c.json({
      status: "error",
      message: "Failed to fetch domains",
      error: (error as Error).message,
    }, 500);
  }
});

// 6. Remove Domain
app.delete("/remove-domain",authMiddleware,  async (c) => {
  try {
    const { domain, type } = await c.req.json();

    // Validate inputs
    if (!domain || !type) {
      return c.json({
        status: "error",
        message: "Domain and type are required",
        timestamp: new Date().toISOString()
      }, 400);
    }

    if (type !== 'disposable' && type !== 'allowlist') {
      return c.json({
        status: "error",
        message: "Invalid domain type. Must be 'disposable' or 'allowlist'",
        timestamp: new Date().toISOString()
      }, 400);
    }

    // Delete from database
    await db
      .delete(domainListsTable)
      .where(and(
        eq(domainListsTable.domain, domain),
        eq(domainListsTable.type, type)
      ));

    try
    {
        const cacheKey = type === 'disposable' ? 'blocklist' : 'allowlist';
        const cached = await redis.get(cacheKey);
        const cachedDomains = cached? JSON.parse(cached) : [];
        cachedDomains.splice(cachedDomains.indexOf(domain), 1);
        await redis.set(cacheKey, JSON.stringify(cachedDomains));
    }
    catch(error)
    {
        console.error("Redis cache update failed:", error);
        return c.json({
          status: "success",
          message: `Domain successfully removed from ${type} list`,
          domain: domain,
          type: type,
        }, 200);

    }
    return c.json({
      status: "success",
      message: `Domain successfully removed from ${type} list`,
      domain: domain,
      type: type,
    }, 200);

  } catch (error) {
    return c.json({
      status: "error",
      message: "Failed to remove domain",
      error: (error as Error).message,
      timestamp: new Date().toISOString()
    }, 500);
  }
});


// 7. Refresh Cache
app.post("/refresh-cache",authMiddleware,  async (c) => {
  try {
    const domains = await db.select().from(domainListsTable);
    
    const blocklist = domains
      .filter(d => d.type === 'disposable')
      .map(d => d.domain);
    
    const allowlist = domains
      .filter(d => d.type === 'allowlist')
      .map(d => d.domain);

    await redis.set("blocklist", JSON.stringify(blocklist));
    await redis.set("allowlist", JSON.stringify(allowlist));

    return c.json({
      status: "success",
      message: "Cache refreshed successfully",
    }, 200);

  } catch (error) {
    return c.json({
      status: "error",
      message: "Failed to refresh cache",
      error: (error as Error).message,
      timestamp: new Date().toISOString()
    }, 500);
  }
});

// 8. Get Audit Logs
app.get("/audit-logs",authMiddleware,  async (c) => {
  try {
    const { page = 1, limit = 10 } = c.req.query();
    const offset = (Number(page) - 1) * Number(limit);

    // Get paginated logs
    const logs = await db
      .select()
      .from(auditLogsTable)
      .orderBy(desc(auditLogsTable.timestamp))
      .offset(offset)
      .limit(Number(limit));

    return c.json({
      status: "success", 
      message: "Audit logs retrieved successfully",
      logs
    }, 200);

  } catch (error) {
    return c.json({
      status: "error",
      message: "Failed to retrieve audit logs",
      error: (error as Error).message,
      timestamp: new Date().toISOString()
    }, 500);
  }
});

// 9. Get Audit Logs (with pagination)
app.get("/audit-logs/pagination",authMiddleware,  async (c) => {
  try {
    const { page = 1, limit = 10 } = c.req.query();
    const offset = (Number(page) - 1) * Number(limit);

    const logs = await db
      .select()
      .from(auditLogsTable)
      .offset(offset)
      .limit(Number(limit))
      .orderBy(desc(auditLogsTable.timestamp));

    return c.json({
      status: "success",
      message: "Audit logs retrieved successfully",
      logs,
    }, 200);

  } catch (error) {
    return c.json({
      status: "error",
      message: "Failed to fetch audit logs",
      error: (error as Error).message,
    }, 500);
  }
});


app.get("/audit-logs/:email",authMiddleware,  async (c) => {
  try {
    const { email } = c.req.param();

    if(!email) {
      return c.json({
        status: "error",
        message: "Email is required",
      }, 400);
    }
    
    const logs = await db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.email, email))
      .orderBy(desc(auditLogsTable.timestamp));

    return c.json({
      status: "success",
      message: `Audit logs retrieved for ${email}`,
      logs
    }, 200);

  } catch (error) {
    return c.json({
      status: "error",
      message: "Failed to fetch audit logs",
      error: (error as Error).message,
    }, 500);
  }
});

export default app;
