import { wakeApi } from "@/chat/wake";

/**
 * Runs once when the web server starts. On Render's free plan that is when the first visitor
 * woke it, so start waking the api now instead of after the page has loaded and connected.
 */
export function register(): void {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const api = process.env.API_URL;
  if (api) wakeApi(api, (url) => fetch(url, { cache: "no-store" }));
}
