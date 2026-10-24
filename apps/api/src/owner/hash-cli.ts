import bcrypt from "bcryptjs";

/**
 * `pnpm owner:hash`: reads the owner's password from stdin and prints its bcrypt hash for
 * OWNER_PASSWORD_HASH. The password is never echoed or stored.
 */
const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
const password = Buffer.concat(chunks)
  .toString("utf8")
  .replace(/\r?\n$/, "");
if (password.length < 12) {
  console.error("Use a password of at least 12 characters.");
  process.exit(1);
}
console.log(await bcrypt.hash(password, 12));
