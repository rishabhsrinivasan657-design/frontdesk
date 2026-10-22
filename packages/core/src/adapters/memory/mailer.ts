import type { ConfirmationEmail, Mailer } from "../../ports/mailer.js";
import { deepCopy } from "./copy.js";

export class InMemoryMailer implements Mailer {
  readonly sent: ConfirmationEmail[] = [];
  private failing = false;

  /** The next send rejects. */
  failNext(): void {
    this.failing = true;
  }

  sendConfirmation(email: ConfirmationEmail): Promise<void> {
    if (this.failing) {
      this.failing = false;
      return Promise.reject(new Error("Mailer failed"));
    }
    this.sent.push(deepCopy(email));
    return Promise.resolve();
  }
}
