import { db } from "@/db/db";
import { domainListsTable } from "@/db/schema";
import { redis } from "@/cache";
import { normalizeEmail, createDomainMatcher } from "@/utils/email";
import { eq } from "drizzle-orm";
import { logAudit } from "@/utils/audit";

interface VerificationResult {
  status: "success" | "blocked" | "error";
  disposable: boolean;
  reason: string;
  domain: string;
  message: string;
}

const CACHE_EXPIRY = 86400; // 24 hours

export class EmailVerificationService {
  private static async getCachedResult(domain: string): Promise<VerificationResult | null> {
    const cached = await redis.get(`check-email:${domain}`);
    return cached ? JSON.parse(cached) : null;
  }

  private static async cacheResult(domain: string, result: VerificationResult): Promise<void> {
    try {
      await redis.set(
        `check-email:${domain}`,
        JSON.stringify(result),
        "EX",
        CACHE_EXPIRY
      );
    } catch (error) {
      console.error("Redis cache update failed:", error);
    }
  }

  private static async getDomainInfo(domain: string) {
    // Single query to get domain info
    const [domainInfo] = await db
      .select({
        type: domainListsTable.type
      })
      .from(domainListsTable)
      .where(eq(domainListsTable.domain, domain))
      .limit(1);

    return domainInfo;
  }

  private static async checkSimilarity(domain: string): Promise<boolean> {
    // Only fetch disposable domains
    const disposableDomains = await db
      .select({ domain: domainListsTable.domain })
      .from(domainListsTable)
      .where(eq(domainListsTable.type, "disposable"));

    const domainMatcher = createDomainMatcher(
      disposableDomains.map((d) => d.domain)
    );

    return domainMatcher.match(domain);
  }

  static async verifyEmail(email: string, ip: string): Promise<VerificationResult> {
    if (!email) {
      throw new Error("Email is required");
    }

    const normalizedEmail = normalizeEmail(email);
    const domain = normalizedEmail.split("@")[1];

    // Check cache first
    const cachedResult = await this.getCachedResult(domain);
    if (cachedResult) {
      return cachedResult;
    }

    // Single query to check domain status
    const domainInfo = await this.getDomainInfo(domain);

    if (domainInfo) {
      // Handle based on domain type
      const isAllowlisted = domainInfo.type === "allowlist";
      const result: VerificationResult = isAllowlisted ? {
        status: "success",
        disposable: false,
        reason: "This domain is on our trusted list",
        domain,
        message: "Great news! This email address is from a trusted provider"
      } : {
        status: "blocked",
        disposable: true,
        reason: "This domain isn't allowed",
        domain,
        message: "This looks like a temporary email address. Please use your regular email instead"
      };

      await logAudit(
        email, 
        domain, 
        ip, 
        isAllowlisted ? "verified_allowlisted_db" : "blocked_disposable_db"
      );
      
      await this.cacheResult(domain, result);
      return result;
    }

    // Only check similarity if domain isn't in our lists
    if (await this.checkSimilarity(domain)) {
      await logAudit(email, domain, ip, "blocked_similarity");
      const result: VerificationResult = {
        status: "blocked",
        disposable: true,
        reason: "Similar to known disposable domains",
        domain,
        message: "Please use a different email address from a trusted provider"
      };
      await this.cacheResult(domain, result);
      return result;
    }

    // Domain appears valid
    await logAudit(email, domain, ip, "verified_unknown");
    const result: VerificationResult = {
      status: "success",
      disposable: false,
      reason: "This domain seems legitimate",
      domain,
      message: "This email address looks good to use"
    };
    await this.cacheResult(domain, result);
    return result;
  }
} 