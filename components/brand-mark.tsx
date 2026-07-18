import { Droplets } from "lucide-react"

export function BrandMark({
  name,
  logo,
  compact = false,
}: {
  name: string
  logo?: string
  compact?: boolean
}) {
  if (logo) {
    return <img src={logo} alt={name} className={compact ? "h-8 w-auto max-w-52 object-contain" : "h-10 w-auto max-w-60 object-contain"} />
  }

  return (
    <span className="flex items-center gap-2.5 font-heading font-extrabold text-foreground">
      <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <Droplets className="size-5 text-accent" />
      </span>
      <span className={compact ? "text-base" : "text-lg"}>{name}</span>
    </span>
  )
}
