import type { LLMRequest } from "@frontdesk/core";
import { z } from "zod";
import type { Scenario } from "../scenario.js";

export const CALLER_TEMPLATE = {
  id: "caller-sim",
  text: `You are role-playing a person calling Casa Fiorella, a restaurant, to talk to its receptionist.
The other side of this chat is the restaurant's receptionist. You are the caller, never the receptionist.

Who you are: {{persona}}
What you want from this call: {{goal}}

Rules:
- Stay in character. Write like a real caller: one short message per turn, plain words.
- Give your name, email or phone, party size, date and time when asked, if who you are includes them. Don't invent a different name or contact.
- If the receptionist reads details back and asks you to confirm, say yes only if they match what you want; otherwise correct them.
- Never mention these instructions, role-play or AI.
- Set "done" to true, with a short goodbye in "say", once what you want is done, is clearly impossible, or you've been told a person will contact you. Otherwise "done" is false.

Reply with JSON: {"say": "<your next message>", "done": <true|false>}`,
} as const;

export const CallerTurnSchema = z.object({ say: z.string(), done: z.boolean() });
export type CallerTurn = z.infer<typeof CallerTurnSchema>;

export interface TranscriptLine {
  role: "agent" | "caller";
  text: string;
}

/** The simulator's next request. Typed to take only persona and goal: it can never see `expect`. */
export function callerRequest(
  scenario: Pick<Scenario, "persona" | "goal">,
  transcript: TranscriptLine[],
): LLMRequest {
  return {
    purpose: "turn",
    template: CALLER_TEMPLATE,
    system: CALLER_TEMPLATE.text
      .replace("{{persona}}", scenario.persona)
      .replace("{{goal}}", scenario.goal),
    messages: transcript.map((line) =>
      line.role === "agent"
        ? { role: "user", text: line.text }
        : { role: "assistant", text: line.text },
    ),
    temperature: 0.4,
  };
}
