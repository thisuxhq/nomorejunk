export const normalizeEmail = (email: string) => email.trim().toLowerCase();

// Create domain matcher which will be used to check domain similarity ex: gmail.com vs gmaill.com, yahoomail.com, etc.
export const createDomainMatcher = (domains: string[]) => {
  const regex = new RegExp(domains.map((d) => `^${d.replace(".", "\\.")}$`).join("|"), "i");
  return {
    match: (domain: string) => regex.test(domain),
  };
};
