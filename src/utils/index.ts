export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const createDomainMatcher = (domains: string[]) => {
  const regex = new RegExp(domains.map((d) => `^${d.replace(".", "\\.")}$`).join("|"), "i");
  return {
    match: (domain: string) => regex.test(domain),
  };
};
