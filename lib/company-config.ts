export type ThemeSource = "custom" | "logo"

export type ThemePalette = {
  primary: string
  accent: string
}

export type GutterColor = {
  id: string
  name: string
  hex: string
  image?: string
}

export type StoryTier = 1 | 2 | 3

export type StoryPrices = {
  1: number
  2: number
  3: number
}

export type GutterProduct = {
  id: string
  name: string
  tagline: string
  description: string
  enabled: boolean
  pricePerFoot: StoryPrices
  warrantyYears: number
  workmanshipYears: number
  badge?: string
  colors: GutterColor[]
}

export type CompanyConfig = {
  companyName: string
  tagline: string
  phone: string
  email: string
  logo: string
  themeSource: ThemeSource
  customTheme: ThemePalette
  logoTheme?: ThemePalette
  primaryColor: string
  accentColor: string
  state: string
  counties: string[]
  gutterProducts: GutterProduct[]
  downspoutPrice: StoryPrices
  metaPixelId: string
}

export const CONFIG_STORAGE_KEY = "gutterquote-company-config-v1"

export const COUNTIES_BY_STATE: Record<string, string[]> = {
  FL: [
    "Alachua", "Baker", "Brevard", "Broward", "Clay", "Collier", "Duval", "Flagler",
    "Hillsborough", "Lake", "Lee", "Marion", "Miami-Dade", "Nassau", "Orange", "Osceola",
    "Palm Beach", "Pasco", "Pinellas", "Polk", "Putnam", "St. Johns", "Seminole", "Volusia",
  ],
  GA: [
    "Barrow", "Bartow", "Chatham", "Cherokee", "Clayton", "Cobb", "Columbia", "Coweta",
    "DeKalb", "Fayette", "Forsyth", "Fulton", "Gwinnett", "Hall", "Henry", "Richmond",
  ],
  NC: [
    "Alamance", "Buncombe", "Cabarrus", "Catawba", "Cumberland", "Durham", "Forsyth", "Gaston",
    "Guilford", "Johnston", "Mecklenburg", "New Hanover", "Union", "Wake",
  ],
  SC: [
    "Aiken", "Anderson", "Beaufort", "Berkeley", "Charleston", "Dorchester", "Greenville", "Horry",
    "Lexington", "Richland", "Spartanburg", "York",
  ],
  TX: [
    "Bexar", "Brazoria", "Collin", "Dallas", "Denton", "El Paso", "Fort Bend", "Harris", "Hays",
    "Montgomery", "Tarrant", "Travis", "Williamson",
  ],
}

export const STATE_NAMES: Record<string, string> = {
  FL: "Florida",
  GA: "Georgia",
  NC: "North Carolina",
  SC: "South Carolina",
  TX: "Texas",
}

const DEFAULT_COLORS: GutterColor[] = [
  ["white-80", "White 80°", "#f7f5ee"],
  ["white-30", "White 30°", "#f1eee5"],
  ["terratone", "Terratone", "#5e554a"],
  ["scotch-red", "Scotch Red", "#7d2f2b"],
  ["royal-brown", "Royal Brown", "#3d2b23"],
  ["traditional-blue", "Traditional Blue", "#314d63"],
  ["pearl-gray", "Pearl Gray", "#b8b8b0"],
  ["musket-brown", "Musket Brown", "#4a382d"],
  ["linen", "Linen", "#ddd3bd"],
  ["forest-green", "Forest Green", "#243d31"],
  ["tuxedo-gray", "Tuxedo Gray", "#5e6261"],
  ["eggshell", "Eggshell", "#e7dfcf"],
  ["dove-gray", "Dove Gray", "#8e918d"],
  ["wicker", "Wicker", "#b7a98f"],
  ["deerskin", "Deerskin", "#a67f5c"],
  ["cream", "Cream", "#eee3c4"],
  ["colonial-gray", "Colonial Gray", "#6f7473"],
  ["cocoa-brown", "Cocoa Brown", "#5b4335"],
  ["clay", "Clay", "#b7a487"],
  ["bronze", "Bronze", "#4b3a2b"],
  ["black", "Black", "#1f2023"],
  ["beaver-brown", "Beaver Brown", "#6b5542"],
  ["antique-ivory", "Antique Ivory", "#d8ccb1"],
  ["almond", "Almond", "#d4c4a6"],
].map(([id, name, hex]) => ({ id, name, hex }))

const BASE_CONFIG: CompanyConfig = {
  companyName: "Summit Gutter Co.",
  tagline: "Fast, transparent gutter pricing for your home.",
  phone: "(904) 555-0184",
  email: "quotes@summitgutters.com",
  logo: "",
  themeSource: "custom",
  customTheme: { primary: "#1e3a4f", accent: "#f5a623" },
  primaryColor: "#1e3a4f",
  accentColor: "#f5a623",
  state: "FL",
  counties: ["Clay", "Duval", "Nassau", "St. Johns"],
  gutterProducts: [
    {
      id: "seamless-aluminum",
      name: "6-inch seamless aluminum gutters",
      tagline: "Best value",
      description: "Custom-cut seamless aluminum gutters with hidden hangers and sealed corners.",
      enabled: true,
      pricePerFoot: { 1: 8, 2: 11, 3: 14 },
      warrantyYears: 20,
      workmanshipYears: 5,
      badge: "Most popular",
      colors: DEFAULT_COLORS,
    },
    {
      id: "gutter-guards",
      name: "Seamless gutters + gutter guards",
      tagline: "Low maintenance",
      description: "Seamless aluminum gutters with perforated aluminum guards to help shed leaves and debris.",
      enabled: true,
      pricePerFoot: { 1: 14, 2: 17, 3: 20 },
      warrantyYears: 20,
      workmanshipYears: 5,
      colors: DEFAULT_COLORS,
    },
  ],
  downspoutPrice: { 1: 85, 2: 150, 3: 215 },
  metaPixelId: "",
}

const deployedConfigValue = process.env.NEXT_PUBLIC_COMPANY_CONFIG

function validStoryPrices(value: unknown, fallback: StoryPrices): StoryPrices {
  if (!value || typeof value !== "object") return fallback
  const prices = value as Partial<StoryPrices>
  return {
    1: Number.isFinite(prices[1]) ? Number(prices[1]) : fallback[1],
    2: Number.isFinite(prices[2]) ? Number(prices[2]) : fallback[2],
    3: Number.isFinite(prices[3]) ? Number(prices[3]) : fallback[3],
  }
}

function normalizeCompanyConfig(value: Partial<CompanyConfig>, fallback: CompanyConfig): CompanyConfig {
  const incomingProducts = Array.isArray(value.gutterProducts) ? value.gutterProducts : []
  const gutterProducts = incomingProducts.length
    ? incomingProducts
        .filter((product) => product?.id && product?.name)
        .slice(0, 8)
        .map((product, index) => {
          const fallbackProduct = fallback.gutterProducts.find((item) => item.id === product.id)
            ?? fallback.gutterProducts[index]
            ?? fallback.gutterProducts[0]
          return {
            ...fallbackProduct,
            ...product,
            pricePerFoot: validStoryPrices(product.pricePerFoot, fallbackProduct.pricePerFoot),
            colors: Array.isArray(product.colors)
              ? product.colors
                  .filter((color) => color?.name && /^#[0-9a-f]{6}$/i.test(color.hex))
                  .slice(0, 32)
              : fallbackProduct.colors,
          }
        })
    : fallback.gutterProducts

  const customTheme = value.customTheme ?? {
    primary: value.primaryColor ?? fallback.primaryColor,
    accent: value.accentColor ?? fallback.accentColor,
  }
  const logoTheme = value.logoTheme?.primary && value.logoTheme?.accent ? value.logoTheme : undefined
  const themeSource = value.themeSource === "logo" && logoTheme ? "logo" : "custom"

  return {
    ...fallback,
    ...value,
    themeSource,
    customTheme,
    ...(logoTheme ? { logoTheme } : {}),
    counties: Array.isArray(value.counties) ? value.counties.slice(0, 100) : fallback.counties,
    gutterProducts,
    downspoutPrice: validStoryPrices(value.downspoutPrice, fallback.downspoutPrice),
  }
}

function readDeployedConfig(): CompanyConfig | null {
  if (!deployedConfigValue) return null
  try {
    const parsed = JSON.parse(deployedConfigValue) as Partial<CompanyConfig>
    if (!parsed.companyName || !Array.isArray(parsed.counties) || !Array.isArray(parsed.gutterProducts)) return null
    return normalizeCompanyConfig(parsed, BASE_CONFIG)
  } catch {
    return null
  }
}

const deployedConfig = readDeployedConfig()

export const IS_DEPLOYED_COMPANY_SITE = Boolean(deployedConfig)
export const DEFAULT_CONFIG: CompanyConfig = deployedConfig ?? BASE_CONFIG

export function loadCompanyConfig(): CompanyConfig {
  if (IS_DEPLOYED_COMPANY_SITE || typeof window === "undefined") return DEFAULT_CONFIG
  try {
    const saved = window.localStorage.getItem(CONFIG_STORAGE_KEY)
    if (!saved) return DEFAULT_CONFIG
    return normalizeCompanyConfig(JSON.parse(saved) as Partial<CompanyConfig>, DEFAULT_CONFIG)
  } catch {
    return DEFAULT_CONFIG
  }
}

export function saveCompanyConfig(config: CompanyConfig) {
  window.localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config))
}

export function enabledProducts(config: CompanyConfig) {
  return config.gutterProducts.filter((product) => product.enabled)
}

export function storyTier(stories: number | undefined | null): StoryTier {
  if (!stories || stories < 2) return 1
  if (stories < 3) return 2
  return 3
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value)
}
