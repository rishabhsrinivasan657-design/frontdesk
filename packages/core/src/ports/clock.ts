export interface Clock {
  now(): Date;
  sleep(ms: number): Promise<void>;
}
