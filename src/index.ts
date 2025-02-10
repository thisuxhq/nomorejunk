import { Hono } from "hono";
import { db } from "@/db/db";
import { usersTable, domainListsTable, auditLogsTable } from "@/db/schema";
import { SelectUsersTable, InsertUsersTable } from "@/db/schema";
import { sign } from "hono/jwt";
import { normalizeEmail, createDomainMatcher, validateEmail } from "@/utils/email";
import { redis } from "@/cache";
import * as bcrypt from "bcryptjs";
import { eq, and, desc } from "drizzle-orm";
import { logAudit } from "@/utils/audit";
import { syncDomainsFromGitHub } from "@/utils/sync-domains-from-github";
import { authMiddleware, logger } from "@/middleware/auth";
import { EmailVerificationService } from "@/services/email-verification";

const app = new Hono();

app.use(logger);

app.get("/", (c) => {
  return c.text("Hello World");
});

// register user
app.post("/register", async (c) => {
  try {
    const { email, password } = await c.req.json();

    if (!email) {
      return c.json(
        {
          error: "Oops! You forgot to provide an email address",
          details: "We need your email to create your account",
          field: "email",
        },
        400
      );
    }
    if (!password) {
      return c.json(
        {
          error: "Hold on! You need a password",
          details: "Please create a password to secure your account",
          field: "password",
        },
        400
      );
    }

    if (!validateEmail(email)) {
      return c.json({
        error: "Registration Error",
        details: "Invalid email address",
        field: "email",
      });
    }

    const [existingUser] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email));

    if (existingUser) {
      return c.json(
        {
          error: "This email is already taken",
          details: "Looks like you already have an account. Try logging in instead?",
          field: "email",
        },
        409
      );
    }

    const hashed_password = await bcrypt.hash(password, 10);

    const userData: InsertUsersTable = {
      email,
      password: hashed_password,
    };

    const [newUser] = await db.insert(usersTable).values(userData).returning();

    const userResponse: Partial<SelectUsersTable> = {
      email: newUser.email,
    };

    return c.json(
      {
        message: "Welcome aboard! Your account has been created successfully",
        user: userResponse,
      },
      201
    );
  } catch (error) {
    return c.json(
      {
        error: "Something went wrong on our end",
        details: "We couldn't create your account right now. Please try again in a moment",
        message: (error as Error).message,
      },
      500
    );
  }
});

// login user
app.post("/login", async (c) => {
  try {
    const { email, password } = await c.req.json();

    if (!email || !password) {
      return c.json(
        {
          error: "We need both your email and password",
          details: "Please fill in all the fields",
          fields: {
            email: !email ? "Don't forget your email address" : null,
            password: !password ? "Your password is missing" : null,
          },
        },
        400
      );
    }

    const [user] = await db
      .select({
        id: usersTable.id,
        email: usersTable.email,
        password: usersTable.password,
      })
      .from(usersTable)
      .where(eq(usersTable.email, email));

    if (!user) {
      return c.json(
        {
          error: "Hmm... that doesn't look right",
          details: "The email or password you entered doesn't match our records",
        },
        401
      );
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return c.json(
        {
          error: "Hmm... that doesn't look right",
          details: "The email or password you entered doesn't match our records",
        },
        401
      );
    }
    if (!process.env.JWT_SECRET) {
      return c.json(
        {
          error: "Internal Server Error",
          details: "JWT secret is not configured",
        },
        500
      );
    }
    const token = await sign(
      {
        id: user.id,
        email: user.email,
        exp: Math.floor(Date.now() / 1000) + 60 * 60,
      },
      process.env.JWT_SECRET
    );

    return c.json(
      {
        message: "Welcome back! You're now logged in",
        token,
      },
      200
    );
  } catch (error) {
    return c.json(
      {
        error: "Oops! Something went wrong",
        details: "We couldn't log you in right now. Please try again",
        message: (error as Error).message,
      },
      500
    );
  }
});

// Sync Domains from GitHub
app.get("/sync-domains", authMiddleware, async (c) => {
  try {
    const startTime = new Date();
    await syncDomainsFromGitHub();

    return c.json(
      {
        status: "success",
        message: "All done! We've updated our domain lists",
        details: {
          source: "GitHub disposable-email-domains repository",
          syncedAt: startTime.toISOString(),
          duration: `${new Date().getTime() - startTime.getTime()}ms`,
        },
      },
      200
    );
  } catch (error) {
    return c.json(
      {
        status: "error",
        message: "We couldn't update the domain lists right now",
        error: (error as Error).message,
      },
      500
    );
  }
});

// Verify if Email is Disposable
app.post("/verify-email", authMiddleware, async (c) => {
  try {
    const { email } = await c.req.json();

    if (!email) {
      return c.json({ 
        status: "error",
        message: "Hey! We need an email address to check",
        error: "Email is required" 
      }, 400);
    }

    const ip = c.req.header("x-forwarded-for") || "unknown";
    const result = await EmailVerificationService.verifyEmail(email, ip);

    // Return 403 for blocked domains, 200 for success
    return c.json(result, result.status === "blocked" ? 403 : 200);
  } catch (error) {
    console.error("Verify email error:", error);
    return c.json({
      status: "error",
      message: "We ran into a problem checking this email",
      error: (error as Error).message
    }, 500);
  }
});

// Add to Blocklist
app.post("/blocklist", authMiddleware, async (c) => {
  try {
    const { domain } = await c.req.json();

    if (!domain) {
      return c.json(
        {
          status: "error",
          message: "Domain is required",
          timestamp: new Date().toISOString(),
        },
        400
      );
    }

    const normalizedDomain = domain.toLowerCase();
    const [existingDomain] = await db
      .select()
      .from(domainListsTable)
      .where(and(eq(domainListsTable.domain, normalizedDomain)));

    if (existingDomain?.type === "disposable") {
      return c.json(
        {
          status: "error",
          message: "Domain already exists in blocklist",
          timestamp: new Date().toISOString(),
        },
        400
      );
    }

    if (existingDomain?.type === "allowlist") {
      await db
        .update(domainListsTable)
        .set({ type: "disposable" })
        .where(eq(domainListsTable.domain, normalizedDomain));

      return c.json(
        {
          status: "success",
          disposable: true,
          message: "Domain moved from allowlist to blocklist",
          domain: normalizedDomain,
        },
        200
      );
    }

    await db
      .insert(domainListsTable)
      .values({ domain: normalizedDomain, type: "disposable" });

    return c.json(
      {
        status: "success",
        message: "Got it! We've added this domain to the blocked list",
        domain: normalizedDomain,
      },
      201
    );
  } catch (error) {
    return c.json(
      {
        status: "error",
        message: "Failed to add domain to blocklist",
        error: (error as Error).message,
        timestamp: new Date().toISOString(),
      },
      500
    );
  }
});

// Add to Allowlist
app.post("/allowlist", authMiddleware, async (c) => {
  try {
    const { domain } = await c.req.json();

    if (!domain) {
      return c.json(
        {
          status: "error",
          message: "Domain is required",
        },
        400
      );
    }

    const normalizedDomain = domain.toLowerCase();
    const [existingDomain] = await db
      .select()
      .from(domainListsTable)
      .where(and(eq(domainListsTable.domain, normalizedDomain)));

    if (existingDomain?.type === "allowlist") {
      return c.json(
        {
          status: "error",
          message: "Domain already exists in allowlist",
        },
        400
      );
    }

    if (existingDomain?.type === "disposable") {
      await db
        .update(domainListsTable)
        .set({ type: "allowlist" })
        .where(eq(domainListsTable.domain, normalizedDomain));

      return c.json(
        {
          status: "success",
          disposable: false,
          message: "Domain moved from blocklist to allowlist",
          domain: normalizedDomain,
        },
        200
      );
    }

    await db
      .insert(domainListsTable)
      .values({ domain: normalizedDomain, type: "allowlist" });

    return c.json(
      {
        status: "success",
        message: "Perfect! This domain is now on our trusted list",
        domain: normalizedDomain,
        type: "allowlist",
      },
      201
    );
  } catch (error) {
    return c.json(
      {
        status: "error",
        message: "Failed to add domain to allowlist",
        error: (error as Error).message,
      },
      500
    );
  }
});

// Get All Domains (with pagination)
app.get("/domains", authMiddleware, async (c) => {
  try {
    const { type, page = 1, limit = 10 } = c.req.query();
    const offset = (Number(page) - 1) * Number(limit);

    if (type !== "disposable" && type !== "allowlist") {
      return c.json(
        {
          status: "error",
          message: "Invalid domain type. Must be 'disposable' or 'allowlist'",
        },
        400
      );
    }

    // Get domains for current page
    const domains = await db
      .select()
      .from(domainListsTable)
      .where(eq(domainListsTable.type, type))
      .offset(offset)
      .limit(Number(limit));

    return c.json(
      {
        status: "success",
        message: `Here are the ${type} domains you requested`,
        domains,
      },
      200
    );
  } catch (error) {
    return c.json(
      {
        status: "error",
        message: "Failed to fetch domains",
        error: (error as Error).message,
      },
      500
    );
  }
});

// Remove Domain
app.delete("/remove-domain", authMiddleware, async (c) => {
  try {
    const { domain, type } = await c.req.json();

    // Validate inputs
    if (!domain || !type) {
      return c.json(
        {
          status: "error",
          message: "Domain and type are required",
        },
        400
      );
    }

    if (type !== "disposable" && type !== "allowlist") {
      return c.json(
        {
          status: "error",
          message: "Invalid domain type. Must be 'disposable' or 'allowlist'",
        },
        400
      );
    }

    // Delete from database
    await db
      .delete(domainListsTable)
      .where(
        and(
          eq(domainListsTable.domain, domain),
          eq(domainListsTable.type, type)
        )
      );

    try {
      const cacheKey = type === "disposable" ? "blocklist" : "allowlist";
      const cached = await redis.get(cacheKey);
      const cachedDomains = cached ? JSON.parse(cached) : [];
      cachedDomains.splice(cachedDomains.indexOf(domain), 1);
      await redis.set(cacheKey, JSON.stringify(cachedDomains));
    } catch (error) {
      console.error("Redis cache update failed:", error);
      return c.json(
        {
          status: "success",
          message: `Domain successfully removed from ${type} list`,
          domain: domain,
          type: type,
        },
        200
      );
    }
    return c.json(
      {
        status: "success",
        message: `All set! We've removed this domain from the ${type} list`,
        domain: domain,
        type: type,
      },
      200
    );
  } catch (error) {
    return c.json(
      {
        status: "error",
        message: "Failed to remove domain",
        error: (error as Error).message,
        timestamp: new Date().toISOString(),
      },
      500
    );
  }
});

//  Refresh Cache
app.post("/refresh-cache", authMiddleware, async (c) => {
  try {
    const domains = await db.select().from(domainListsTable);

    const blocklist = domains
      .filter((d) => d.type === "disposable")
      .map((d) => ({ domain: d.domain, type: d.type }));

    const allowlist = domains
      .filter((d) => d.type === "allowlist")
      .map((d) => ({ domain: d.domain, type: d.type }));

    await redis.del(...await redis.keys('check-email:*'));

    const pipeline = redis.pipeline();
    
    [...blocklist, ...allowlist].forEach(({ domain, type }) => {
      const cacheData = type === 'disposable' 
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
        86400
      );
    });

    // Execute all commands in the pipeline at once
    await pipeline.exec();

    return c.json(
      {
        status: "success",
        message: "Cache refreshed! Everything is up to date now",
        count: blocklist.length + allowlist.length
      },
      200
    );
  } catch (error) {
    console.error("Cache refresh error:", error);
    return c.json(
      {
        status: "error",
        message: "Failed to refresh cache",
        error: (error as Error).message,
      },
      500
    );
  }
});

// Get Audit Logs (with pagination)
app.get("/audit-logs/pagination", authMiddleware, async (c) => {
  try {
    const { page = 1, limit = 10 } = c.req.query();
    const offset = (Number(page) - 1) * Number(limit);

    const logs = await db
      .select()
      .from(auditLogsTable)
      .offset(offset)
      .limit(Number(limit))
      .orderBy(desc(auditLogsTable.timestamp));

    return c.json(
      {
        status: "success",
        message: "Here's your activity history",
        logs,
      },
      200
    );
  } catch (error) {
    return c.json(
      {
        status: "error",
        message: "Oops! We couldn't load your activity history right now",
        error: (error as Error).message,
      },
      500
    );
  }
});

// Get Audit Logs by Email
app.get("/audit-logs/:email", authMiddleware, async (c) => {
  try {
    const { email } = c.req.param();

    if (!email) {
      return c.json(
        {
          status: "error",
          message: "We need an email address to look up the activity history",
        },
        400
      );
    }

    const logs = await db
      .select()
      .from(auditLogsTable)
      .where(eq(auditLogsTable.email, email))
      .orderBy(desc(auditLogsTable.timestamp));

    if (logs.length === 0) {
      return c.json(
        {
          status: "success",
          message: `No activity found for ${email} yet`,
          logs: [],
        },
        200
      );
    }

    return c.json(
      {
        status: "success",
        message: `Here's the activity history for ${email}`,
        logs,
      },
      200
    );
  } catch (error) {
    return c.json(
      {
        status: "error",
        message: "We had trouble retrieving the activity history",
        error: (error as Error).message,
      },
      500
    );
  }
});

export default app;
