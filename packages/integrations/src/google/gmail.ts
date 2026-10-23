import type { ConfirmationEmail, Mailer } from "@frontdesk/core";
import { type gmail_v1, google } from "googleapis";
import { createOAuthClient, GOOGLE_API_OPTIONS } from "./client.js";
import type { GoogleEnv } from "./env.js";
import { googleFailure } from "./errors.js";
import { buildRawMessage, renderConfirmation } from "./mime.js";

/** The slice of googleapis' `gmail.users.messages` this adapter uses. */
export interface MessagesApi {
  send(p: gmail_v1.Params$Resource$Users$Messages$Send): Promise<{ data: gmail_v1.Schema$Message }>;
}

/** Sends confirmation emails from the signed-in Google account (scope: gmail.send only). */
export class GmailMailer implements Mailer {
  constructor(private readonly opts: { messages: MessagesApi; timeZone: string }) {}

  async sendConfirmation(email: ConfirmationEmail): Promise<void> {
    const raw = buildRawMessage({ to: email.to, ...renderConfirmation(email, this.opts.timeZone) });
    try {
      await this.opts.messages.send({ userId: "me", requestBody: { raw } });
    } catch (error) {
      throw googleFailure(error, "Gmail send");
    }
  }
}

export function createGmailMailer(env: GoogleEnv, timeZone: string): GmailMailer {
  const api = google.gmail({ version: "v1", auth: createOAuthClient(env), ...GOOGLE_API_OPTIONS });
  return new GmailMailer({ messages: api.users.messages, timeZone });
}
