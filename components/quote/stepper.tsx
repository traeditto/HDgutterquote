import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

const STEPS = ["Address", "Gutter scan", "Your details", "Your quote"]

export function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex items-center justify-center gap-1 sm:gap-3">
      {STEPS.map((label, index) => {
        const isDone = index < current
        const isActive = index === current
        return (
          <li key={label} className="flex items-center gap-1 sm:gap-3">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold transition-colors",
                  isDone && "border-accent bg-accent text-accent-foreground",
                  isActive && "border-primary bg-primary text-primary-foreground",
                  !isDone && !isActive && "border-border bg-card text-muted-foreground",
                )}
              >
                {isDone ? <Check className="size-4" /> : index + 1}
              </span>
              <span
                className={cn(
                  "hidden text-sm font-medium sm:inline",
                  isActive ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
            </div>
            {index < STEPS.length - 1 && (
              <span
                className={cn(
                  "h-px w-4 sm:w-8",
                  index < current ? "bg-accent" : "bg-border",
                )}
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}
