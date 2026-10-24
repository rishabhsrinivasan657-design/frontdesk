export function HandoffBanner({ message }: { message: string }) {
  return (
    <div
      role="status"
      data-testid="handoff-banner"
      className="rounded-lg border border-border bg-secondary px-3 py-2 text-sm"
    >
      <p className="font-medium">A member of our team will take it from here.</p>
      <p className="text-muted-foreground">{message}</p>
    </div>
  );
}
