const GMAIL = new Set(["gmail.com", "googlemail.com"]);

/**
 * The key a contact is counted under for abuse caps (M10): addresses that reach one inbox, and
 * one US phone number written different ways, count once. Only for counting, never for sending.
 */
export function quotaKey(contact: string): string {
  const trimmed = contact.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at > 0) {
    let local = trimmed.slice(0, at).split("+")[0]!;
    let domain = trimmed.slice(at + 1);
    if (GMAIL.has(domain)) {
      local = local.replaceAll(".", "");
      domain = "gmail.com";
    }
    return `${local}@${domain}`;
  }
  const digits = trimmed.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}
