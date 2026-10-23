import type { ConfirmationEmail } from "@frontdesk/core";

/** One bare address, nothing that could smuggle a second recipient or header. */
const SINGLE_ADDRESS = /^[^\s@,;<>"()]+@[^\s@,;<>"()]+\.[^\s@,;<>"()]+$/;

/** A CR or LF in a header value would start a new header (e.g. "Bcc:"). */
const oneLine = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

/** RFC 2047 encoded-word for non-ASCII header text. */
const encodeHeader = (value: string) =>
  /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;

/** An RFC 2822 plain-text message, base64url-encoded as Gmail's `raw` field expects. */
export function buildRawMessage(m: { to: string; subject: string; text: string }): string {
  const to = m.to.trim();
  if (!SINGLE_ADDRESS.test(to)) throw new Error("Confirmation email needs a single plain address");
  const message = [
    `To: ${to}`,
    `Subject: ${encodeHeader(oneLine(m.subject))}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(m.text).toString("base64"),
  ].join("\r\n");
  return Buffer.from(message).toString("base64url");
}

const SUBJECT: Record<ConfirmationEmail["kind"], string> = {
  book: "is confirmed",
  reschedule: "has been moved",
  cancel: "has been cancelled",
};

/** The confirmation's subject and body, with times in the business's time zone. */
export function renderConfirmation(
  email: ConfirmationEmail,
  timeZone: string,
): { subject: string; text: string } {
  const { booking: b, businessName } = email;
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(b.start);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(b.start);
  const when = `${day} at ${time}`;
  const what = `a table for ${b.partySize} on ${when} under ${b.name}`;
  const lead =
    email.kind === "cancel"
      ? `Your reservation for ${what} has been cancelled.`
      : email.kind === "reschedule"
        ? `Your reservation has been moved: ${what}.`
        : `You're booked: ${what}.`;
  return {
    subject: `Your reservation at ${businessName} ${SUBJECT[email.kind]}`,
    text: `${lead}\n\nSee you soon,\n${businessName}\n`,
  };
}
