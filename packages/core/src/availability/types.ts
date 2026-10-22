/** An existing booking, read from Calendar. It blocks `tableId` on [start, end). */
export interface Reservation {
  id: string;
  start: Date;
  end: Date;
  tableId: string;
  partySize: number;
}

export interface SlotRequest {
  /** Business-local date, "YYYY-MM-DD". */
  date: string;
  /** Business-local time, "HH:mm". Omit to list the whole day. */
  time?: string;
  partySize: number;
}

export interface Slot {
  /** Deterministic: `${date}T${time}@${tableId}#${partySize}`. */
  id: string;
  date: string;
  time: string;
  /** ISO 8601 with the business offset, no milliseconds. */
  start: string;
  end: string;
  tableId: string;
  tableSize: number;
  partySize: number;
}
