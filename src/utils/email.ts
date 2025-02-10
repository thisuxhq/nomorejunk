// Normalize email
export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

// Create domain matcher which will be used to check domain similarity ex: gmail.com vs gmaill.com, yahoomail.com, etc.
export function createDomainMatcher(domains: string[]) {
  const regex = new RegExp(
    domains.map((d) => `^${d.replace(".", "\\.")}$`).join("|"),
    "i"
  );
  return {
    match: (domain: string) => regex.test(domain),
  };
};

// Validate email
export function validateEmail(email: string): boolean {
  const emailRegex = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,4}$/;
  return emailRegex.test(email);
}
