/**
 * Online bookings per contact and per chat session per day (M10 abuse limit). `day` is the
 * business-timezone date (YYYY-MM-DD) the booking was made on. Contacts are compared by
 * `quotaKey`, so case, +tags or a +1 can't dodge the cap; the session cap stops one chat from
 * booking under many made-up contacts.
 */
export interface BookingQuota {
  /** Bookings still allowed: the smaller of the contact's and the session's allowance. */
  remaining(contact: string, day: string, sessionId: string): Promise<number>;
  record(contact: string, day: string, sessionId: string): Promise<void>;
}
