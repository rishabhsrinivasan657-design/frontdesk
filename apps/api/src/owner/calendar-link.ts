/** A Google Calendar link to one event: `eid` is base64url("<eventId> <calendarId>"). */
export function calendarEventUrl(eventId: string, calendarId: string): string {
  const eid = Buffer.from(`${eventId} ${calendarId}`).toString("base64url");
  return `https://www.google.com/calendar/event?eid=${eid}`;
}
