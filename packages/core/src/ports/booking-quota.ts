/**
 * Online bookings per contact per day (M10 abuse limit). `day` is the business-timezone date
 * (YYYY-MM-DD) the booking was made on. Implementations compare contacts after
 * `normalizeContact`, so case and spacing can't dodge the cap.
 */
export interface BookingQuota {
  remaining(contact: string, day: string): Promise<number>;
  record(contact: string, day: string): Promise<void>;
}
