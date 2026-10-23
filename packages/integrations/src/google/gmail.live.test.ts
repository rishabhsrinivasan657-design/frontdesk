import { runMailerContract } from "@frontdesk/core/testing";
import { createGmailMailer } from "./gmail.js";
import { liveGoogleEnv } from "./live-env.js";

const env = liveGoogleEnv();

// Sends two real emails to GMAIL_TEST_TO (your own address).
runMailerContract(
  "Gmail",
  () => ({ mailer: createGmailMailer(env!, "America/New_York"), to: env!.gmailTestTo! }),
  { skip: env?.gmailTestTo === undefined },
);
