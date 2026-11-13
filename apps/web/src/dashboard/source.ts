import type { OwnerSource } from "./types";

/**
 * Which data set the dashboard opens on. A deploy that stores guests as pilot
 * (`CONVERSATION_SOURCE=pilot`, as on Render) sets `NEXT_PUBLIC_DASHBOARD_SOURCE=pilot` so the
 * owner doesn't land on an empty Live view.
 */
export function defaultSource(env: string | undefined): OwnerSource {
  return env === "pilot" ? "pilot" : "live";
}

export const DEFAULT_SOURCE = defaultSource(process.env.NEXT_PUBLIC_DASHBOARD_SOURCE);

/** `?source=` from page search params; anything but an explicit "live"/"pilot" is the default. */
export function sourceParam(
  value: string | string[] | null | undefined,
  fallback: OwnerSource = DEFAULT_SOURCE,
): OwnerSource {
  return value === "pilot" || value === "live" ? value : fallback;
}

/** The `?source=…` a dashboard link needs to keep this data set: empty for the default. */
export function sourceQuery(source: OwnerSource, fallback: OwnerSource = DEFAULT_SOURCE): string {
  return source === fallback ? "" : `?source=${source}`;
}
