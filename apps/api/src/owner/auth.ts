import bcrypt from "bcryptjs";

export const COOKIE = "fd_owner";

/** Compared against when the email is wrong, so a wrong email costs as much as a wrong password. */
const DUMMY_HASH = "$2b$12$bX13T.PXi3cmoJZoO/EM1u2NHtVfbtDDxO//tL/sTA3fMNBfmRTdK";

const normalize = (email: string) => email.trim().toLowerCase();

/** True only for the owner's email (any case) and password. bcrypt always runs. */
export async function checkCredentials(
  owner: { email: string; passwordHash: string },
  email: string,
  password: string,
): Promise<boolean> {
  const emailOk = normalize(email) === normalize(owner.email);
  const passwordOk = await bcrypt.compare(password, emailOk ? owner.passwordHash : DUMMY_HASH);
  return emailOk && passwordOk;
}
