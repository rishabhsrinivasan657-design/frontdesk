import {
  LLMError,
  type LLMChunk,
  type LLMMessage,
  type LLMProvider,
  type LLMRequest,
  type ToolCall,
  type Usage,
} from "@frontdesk/core";
import type { ZodType } from "zod";

const META = '@meta {"confidence":0.9,"onTopic":true}\n';
const USAGE: Usage = { inputTokens: 120, outputTokens: 30 };

export const SCRIPTED_REPLIES = {
  open: "That time is open. What name and email should I use?",
  full: "That time is full. Could you try another time?",
  other: "How can I help with a reservation?",
} as const;

const ASK = /table for (\d+) on (\d{4}-\d{2}-\d{2}) at (\d{1,2}:\d{2})/i;
const MOVE = /make it (\d{1,2}:\d{2})/i;
const DETAILS = /^\s*([^,]+),\s*(\S+@\S+)\s*$/;

interface AvailabilityArgs {
  date: string;
  time: string;
  partySize: number;
}

/** The caller's text inside `<caller_message>` (angle brackets stay escaped; we never need them). */
function callerText(message: LLMMessage | undefined): string | undefined {
  if (message?.role !== "user") return undefined;
  return message.text.replace(/^<caller_message>\n?/, "").replace(/\n?<\/caller_message>$/, "");
}

/**
 * A deterministic receptionist for tests and e2e (`LLM_PROVIDER=scripted`): no keys, no network.
 * It books one table by date, time and party size, can move the time, and answers anything
 * else generically. Its replies state no times, dates or prices, so grounding always passes.
 */
export class ScriptedLLM implements LLMProvider {
  readonly model = "scripted";
  private calls = 0;

  // Replies are computed synchronously; the generator stays async to match the interface.
  // eslint-disable-next-line @typescript-eslint/require-await
  async *stream(req: LLMRequest): AsyncIterable<LLMChunk> {
    if (req.purpose !== "turn") throw new LLMError("invalid_output", "scripted: turn only");
    yield* this.respond(req.messages);
    yield { type: "usage", usage: USAGE };
  }

  generate<T>(req: LLMRequest, schema: ZodType<T>): Promise<{ value: T; usage: Usage }> {
    return Promise.resolve().then(() => {
      if (req.purpose !== "confirmation") {
        throw new LLMError("invalid_output", "scripted: confirmation only");
      }
      const text = callerText(req.messages.at(-1)) ?? "";
      const decision = /change|actually|instead/i.test(text)
        ? "change"
        : /^\s*(no|nope)\b/i.test(text)
          ? "deny"
          : /^\s*(yes|confirm)/i.test(text)
            ? "confirm"
            : "unrelated";
      return { value: schema.parse({ decision, confidence: 0.9 }), usage: USAGE };
    });
  }

  private respond(messages: LLMMessage[]): LLMChunk[] {
    const last = messages.at(-1);
    if (last?.role === "tool" && last.name === "check_availability") {
      const asked = lastAvailabilityCall(messages);
      const open = asked ? offeredSlotId(messages, asked) !== undefined : false;
      return [this.text(open ? SCRIPTED_REPLIES.open : SCRIPTED_REPLIES.full)];
    }
    const text = callerText(last);
    if (text === undefined) return [this.text(SCRIPTED_REPLIES.other)];

    const ask = ASK.exec(text);
    if (ask) {
      return [
        this.call("check_availability", {
          date: ask[2],
          time: ask[3]!.padStart(5, "0"),
          partySize: Number(ask[1]),
        }),
      ];
    }
    const previous = lastAvailabilityCall(messages);
    const move = MOVE.exec(text);
    if (move && previous) {
      return [
        this.call("check_availability", { ...previous.args, time: move[1]!.padStart(5, "0") }),
      ];
    }
    const details = DETAILS.exec(text);
    const slotId = previous && offeredSlotId(messages, previous);
    if (details && previous && slotId) {
      return [
        this.call("book", {
          slotId,
          name: details[1]!.trim(),
          contact: details[2],
          partySize: previous.args.partySize,
        }),
      ];
    }
    return [this.text(SCRIPTED_REPLIES.other)];
  }

  private text(body: string): LLMChunk {
    return { type: "text", text: `${META}${body}` };
  }

  private call(name: string, args: Record<string, unknown>): LLMChunk {
    return { type: "tool_call", call: { id: `scripted_${++this.calls}`, name, args } };
  }
}

function lastAvailabilityCall(
  messages: LLMMessage[],
): { call: ToolCall; args: AvailabilityArgs } | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "assistant") continue;
    const call = m.toolCalls?.findLast((c) => c.name === "check_availability");
    if (call) return { call, args: call.args as unknown as AvailabilityArgs };
  }
  return undefined;
}

/** The slot id that call's result offered at exactly the requested time, if any. */
function offeredSlotId(
  messages: LLMMessage[],
  asked: { call: ToolCall; args: AvailabilityArgs },
): string | undefined {
  const result = messages.find((m) => m.role === "tool" && m.callId === asked.call.id);
  if (result?.role !== "tool") return undefined;
  const data = (
    result.result as { ok?: boolean; data?: { slots?: { slotId: string; time: string }[] } }
  ).data;
  return data?.slots?.find((s) => s.time === asked.args.time)?.slotId;
}
