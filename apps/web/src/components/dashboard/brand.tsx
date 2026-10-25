import { Icon } from "@/components/icons";
import { cn } from "@/lib/utils";

/** Casa Fiorella's wordmark with the Front Desk product name. */
export function Brand({ size = "md", className }: { size?: "md" | "lg"; className?: string }) {
  const lg = size === "lg";
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span
        className={cn(
          "grid shrink-0 place-items-center rounded-full bg-primary text-primary-foreground",
          lg ? "size-12" : "size-9",
        )}
      >
        <Icon name="utensils" className={lg ? "size-6" : "size-4"} />
      </span>
      <span className="flex flex-col leading-tight">
        <span className={cn("font-heading font-bold tracking-wide", lg ? "text-2xl" : "text-lg")}>
          Casa Fiorella
        </span>
        <span className="text-xs font-medium tracking-[0.2em] text-accent uppercase">
          Front Desk
        </span>
      </span>
    </div>
  );
}
