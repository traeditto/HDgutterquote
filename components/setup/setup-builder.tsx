"use client"

import Link from "next/link"
import { ChangeEvent, useEffect, useMemo, useState } from "react"
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  CloudUpload,
  Globe2,
  LoaderCircle,
  ExternalLink,
  MapPinned,
  Palette,
  Plus,
  Rocket,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
} from "lucide-react"
import { BrandMark } from "@/components/brand-mark"
import {
  CompanyConfig,
  COUNTIES_BY_STATE,
  DEFAULT_CONFIG,
  formatCurrency,
  GutterProduct,
  loadCompanyConfig,
  saveCompanyConfig,
  STATE_NAMES,
  ThemePalette,
  ThemeSource,
} from "@/lib/company-config"

const steps = [
  { title: "Company", subtitle: "Brand & contact", icon: Building2 },
  { title: "Service area", subtitle: "Counties you cover", icon: MapPinned },
  { title: "Products", subtitle: "Systems & pricing", icon: CircleDollarSign },
  { title: "Publish", subtitle: "Review & launch", icon: Sparkles },
]

type DeploymentResponse = {
  project: { id: string; name: string; created: boolean }
  deployment: { id: string; url: string; readyState: string; inspectorUrl: string }
  domain: {
    name: string
    verified: boolean
    verification?: Array<{ type?: string; domain?: string; value?: string; reason?: string }>
  } | null
  dashboardUrl: string
}

function projectSlug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90)
}

export function SetupBuilder() {
  const [config, setConfig] = useState<CompanyConfig>(DEFAULT_CONFIG)
  const [activeStep, setActiveStep] = useState(0)
  const [customCounty, setCustomCounty] = useState("")
  const [saved, setSaved] = useState(false)
  const [vercelProject, setVercelProject] = useState(projectSlug(DEFAULT_CONFIG.companyName))
  const [customDomain, setCustomDomain] = useState("")
  const [deployKey, setDeployKey] = useState("")
  const [deploying, setDeploying] = useState(false)
  const [deployError, setDeployError] = useState("")
  const [deployment, setDeployment] = useState<DeploymentResponse | null>(null)
  const [newColors, setNewColors] = useState<Record<string, { name: string; hex: string }>>({})

  useEffect(() => {
    const loaded = loadCompanyConfig()
    setConfig(loaded)
    setVercelProject(projectSlug(loaded.companyName))
  }, [])

  const update = <K extends keyof CompanyConfig>(key: K, value: CompanyConfig[K]) => {
    setConfig((current) => ({ ...current, [key]: value }))
    setSaved(false)
  }

  const updateProduct = (id: string, patch: Partial<GutterProduct>) => {
    update(
      "gutterProducts",
      config.gutterProducts.map((product) => (product.id === id ? { ...product, ...patch } : product)),
    )
  }

  const handleLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > 1_500_000) {
      window.alert("Please choose a logo smaller than 1.5 MB.")
      return
    }
    try {
      const processed = await processLogo(file)
      setConfig((current) => ({
        ...current,
        logo: processed.dataUrl,
        logoTheme: processed.palette,
        ...(current.themeSource === "logo" ? {
          primaryColor: processed.palette.primary,
          accentColor: processed.palette.accent,
        } : {}),
      }))
      setSaved(false)
    } catch {
      window.alert("That logo could not be processed. Please try a PNG, JPG, SVG, or WebP file.")
    }
  }

  const chooseThemeSource = (themeSource: ThemeSource) => {
    const palette = themeSource === "logo" ? config.logoTheme : config.customTheme
    if (!palette) return
    setConfig((current) => ({
      ...current,
      themeSource,
      primaryColor: palette.primary,
      accentColor: palette.accent,
    }))
    setSaved(false)
  }

  const updateThemeColor = (key: keyof ThemePalette, value: string) => {
    setConfig((current) => {
      const paletteKey = current.themeSource === "logo" ? "logoTheme" : "customTheme"
      const palette = current[paletteKey] ?? { primary: current.primaryColor, accent: current.accentColor }
      return {
        ...current,
        [paletteKey]: { ...palette, [key]: value },
        [key === "primary" ? "primaryColor" : "accentColor"]: value,
      }
    })
    setSaved(false)
  }

  const removeLogo = () => {
    setConfig((current) => ({
      ...current,
      logo: "",
      logoTheme: undefined,
      themeSource: "custom",
      primaryColor: current.customTheme.primary,
      accentColor: current.customTheme.accent,
    }))
    setSaved(false)
  }

  const toggleCounty = (county: string) => {
    update(
      "counties",
      config.counties.includes(county)
        ? config.counties.filter((item) => item !== county)
        : [...config.counties, county],
    )
  }

  const addCustomCounty = () => {
    const county = customCounty.trim().replace(/\s+County$/i, "")
    if (county && !config.counties.includes(county)) update("counties", [...config.counties, county])
    setCustomCounty("")
  }

  const activeProducts = useMemo(
    () => config.gutterProducts.filter((product) => product.enabled),
    [config.gutterProducts],
  )

  const publish = () => {
    saveCompanyConfig(config)
    setSaved(true)
    setVercelProject((current) => current || projectSlug(config.companyName))
    setActiveStep(3)
  }

  const deployToVercel = async () => {
    setDeploying(true)
    setDeployError("")
    setDeployment(null)

    try {
      const response = await fetch("/api/vercel/deploy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-gutterquote-deploy-key": deployKey,
        },
        body: JSON.stringify({
          config,
          projectName: vercelProject,
          domain: customDomain,
        }),
      })
      const result = (await response.json()) as DeploymentResponse & { error?: string }
      if (!response.ok) throw new Error(result.error || "Vercel could not start the deployment.")
      setDeployment(result)
    } catch (error) {
      setDeployError(error instanceof Error ? error.message : "Vercel could not start the deployment.")
    } finally {
      setDeploying(false)
    }
  }

  return (
    <main
      className="setup-shell"
      style={{ "--brand": config.primaryColor, "--primary": config.primaryColor, "--accent": config.accentColor } as React.CSSProperties}
    >
      <aside className="setup-sidebar">
        <Link href="/" className="setup-product">
          <span className="setup-product__icon"><Settings2 size={19} /></span>
          <span>GutterQuote <b>Studio</b></span>
        </Link>

        <div className="setup-sidebar__intro">
          <span>Company setup</span>
          <h1>Make it yours.</h1>
          <p>Configure one reusable instant quote experience for your gutter company.</p>
        </div>

        <nav className="setup-steps" aria-label="Setup progress">
          {steps.map((step, index) => {
            const Icon = step.icon
            const complete = index < activeStep || (index === 3 && saved)
            return (
              <button
                key={step.title}
                type="button"
                className={`setup-step ${index === activeStep ? "is-active" : ""}`}
                onClick={() => setActiveStep(index)}
              >
                <span className="setup-step__icon">
                  {complete ? <Check size={18} /> : <Icon size={18} />}
                </span>
                <span><b>{step.title}</b><small>{step.subtitle}</small></span>
              </button>
            )
          })}
        </nav>

        <div className="setup-sidebar__footer">
          <ShieldCheck size={18} />
          <span><b>Private by default</b><small>Your draft stays in this browser.</small></span>
        </div>
      </aside>

      <section className="setup-workspace">
        <header className="setup-topbar">
          <div className="mobile-product">GutterQuote <b>Studio</b></div>
          <div className="setup-topbar__status"><span /> Draft saved locally</div>
          <Link href="/" className="text-link">View quote site <ExternalLink size={15} /></Link>
        </header>

        <div className="setup-canvas">
          <div className="setup-form-column">
            <div className="setup-progress-mobile">
              <span>Step {activeStep + 1} of 4</span>
              <div><i style={{ width: `${((activeStep + 1) / 4) * 100}%` }} /></div>
            </div>

            {activeStep === 0 && (
              <SetupSection
                eyebrow="01 · Your company"
                title="Start with your brand"
                description="These details appear across the quote experience and customer estimate."
              >
                <div className="logo-upload-row">
                  <label className="logo-upload">
                    <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={handleLogo} />
                    {config.logo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={config.logo} alt="Uploaded company logo" />
                    ) : (
                      <CloudUpload size={25} />
                    )}
                  </label>
                  <div>
                    <b>Company logo</b>
                    <p>PNG, JPG, SVG or WebP. Max 1.5 MB.</p>
                    <label className="upload-link">
                      {config.logo ? "Replace logo" : "Upload logo"}
                      <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={handleLogo} />
                    </label>
                    {config.logo && <button type="button" className="remove-link" onClick={removeLogo}>Remove</button>}
                  </div>
                </div>

                <div className="theme-source-field">
                  <div className="theme-source-field__heading"><span><Palette size={15} /> Site theme</span><small>Choose page colors or start from colors extracted from your logo.</small></div>
                  <div className="theme-source-options">
                    <button type="button" className={config.themeSource === "custom" ? "is-selected" : ""} onClick={() => chooseThemeSource("custom")}>
                      <span className="theme-preview-dots"><i style={{ background: config.customTheme.primary }} /><i style={{ background: config.customTheme.accent }} /></span>
                      <span><b>Choose page colors</b><small>Set your primary and accent colors.</small></span><Check size={14} />
                    </button>
                    <button type="button" disabled={!config.logo || !config.logoTheme} className={config.themeSource === "logo" ? "is-selected" : ""} onClick={() => chooseThemeSource("logo")}>
                      <span className="theme-preview-dots"><i style={{ background: config.logoTheme?.primary || "#D7DDD8" }} /><i style={{ background: config.logoTheme?.accent || "#EEF1EE" }} /></span>
                      <span><b>Use logo colors</b><small>{config.logoTheme ? "Palette extracted and ready." : "Upload a logo to generate a palette."}</small></span><Check size={14} />
                    </button>
                  </div>
                </div>

                <div className="field-grid">
                  <Field label="Company name" wide>
                    <input value={config.companyName} onChange={(e) => update("companyName", e.target.value)} placeholder="Acme Gutter Co." />
                  </Field>
                  <Field label="Tagline" wide hint="Shown beneath your main quote headline.">
                    <input value={config.tagline} onChange={(e) => update("tagline", e.target.value)} placeholder="Clear gutter pricing starts here." />
                  </Field>
                  <Field label="Phone number">
                    <input value={config.phone} onChange={(e) => update("phone", e.target.value)} placeholder="(555) 555-0199" />
                  </Field>
                  <Field label="Quote email">
                    <input type="email" value={config.email} onChange={(e) => update("email", e.target.value)} placeholder="quotes@company.com" />
                  </Field>
                  <Field label={config.themeSource === "logo" ? "Logo primary color" : "Primary page color"} hint="Used for page backgrounds, headings, and buttons.">
                    <ColorInput label="Primary theme" value={config.primaryColor} onChange={(value) => updateThemeColor("primary", value)} />
                  </Field>
                  <Field label={config.themeSource === "logo" ? "Logo accent color" : "Accent page color"} hint="Used for highlights and selected states.">
                    <ColorInput label="Accent theme" value={config.accentColor} onChange={(value) => updateThemeColor("accent", value)} />
                  </Field>
                  <Field label="Meta Pixel ID" wide hint="Optional. Used for browser and Conversions API tracking when the server token is configured.">
                    <input value={config.metaPixelId} onChange={(e) => update("metaPixelId", e.target.value.replace(/\D/g, ""))} placeholder="123456789012345" />
                  </Field>
                </div>
              </SetupSection>
            )}

            {activeStep === 1 && (
              <SetupSection
                eyebrow="02 · Service area"
                title="Where do you work?"
                description="Only customers in selected counties can continue to an instant quote."
              >
                <Field label="State" wide>
                  <div className="select-wrap">
                    <select value={config.state} onChange={(e) => { update("state", e.target.value); update("counties", []) }}>
                      {Object.entries(STATE_NAMES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                    </select>
                    <ChevronDown size={16} />
                  </div>
                </Field>

                <div className="county-heading">
                  <div><b>Select counties</b><p>{config.counties.length} currently selected</p></div>
                  <button type="button" onClick={() => update("counties", COUNTIES_BY_STATE[config.state] ?? [])}>Select all</button>
                </div>
                <div className="county-grid">
                  {(COUNTIES_BY_STATE[config.state] ?? []).map((county) => (
                    <label key={county} className={config.counties.includes(county) ? "is-selected" : ""}>
                      <input type="checkbox" checked={config.counties.includes(county)} onChange={() => toggleCounty(county)} />
                      <span><Check size={13} /></span>{county} County
                    </label>
                  ))}
                </div>

                <div className="custom-county">
                  <div><Plus size={17} /><span><b>Don’t see a county?</b><small>Add any county to your service area.</small></span></div>
                  <div><input value={customCounty} onChange={(e) => setCustomCounty(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCustomCounty()} placeholder="County name" /><button type="button" onClick={addCustomCounty}>Add</button></div>
                </div>

                {config.counties.some((county) => !(COUNTIES_BY_STATE[config.state] ?? []).includes(county)) && (
                  <div className="custom-chips">
                    {config.counties.filter((county) => !(COUNTIES_BY_STATE[config.state] ?? []).includes(county)).map((county) => (
                      <button key={county} type="button" onClick={() => toggleCounty(county)}>{county} County <span>×</span></button>
                    ))}
                  </div>
                )}
              </SetupSection>
            )}

            {activeStep === 2 && (
              <SetupSection
                eyebrow="03 · Products & pricing"
                title="Build your gutter menu"
                description="Enable the systems you install, set height-based pricing, and choose the finishes customers can preview."
              >
                <div className="pricing-note"><CircleDollarSign size={19} /><p><b>Pricing is per linear foot.</b> The quote adds the configured downspout price based on the estimated home height.</p></div>
                <div className="mb-4 grid gap-3 rounded-xl border border-[#dfe4df] bg-white p-4 sm:grid-cols-3">
                  {([1, 2, 3] as const).map((tier) => (
                    <Field key={tier} label={`${tier === 3 ? "3+" : tier}-story downspout`}>
                      <div className="money-input"><span>$</span><input type="number" min="0" value={config.downspoutPrice[tier]} onChange={(e) => update("downspoutPrice", { ...config.downspoutPrice, [tier]: Number(e.target.value) })} /><small>each</small></div>
                    </Field>
                  ))}
                </div>
                <div className="roof-system-list">
                  {config.gutterProducts.map((product) => (
                    <article key={product.id} className={`roof-system-card ${product.enabled ? "is-enabled" : ""}`}>
                      <div className="roof-system-card__top">
                        <div className="roof-symbol"><span /></div>
                        <div><b>{product.name}</b><p>{product.description}</p></div>
                        <label className="switch">
                          <input type="checkbox" checked={product.enabled} onChange={(e) => updateProduct(product.id, { enabled: e.target.checked })} />
                          <span />
                        </label>
                      </div>
                      {product.enabled && (
                        <div className="border-t border-[#e5e8e4] bg-[#fbfcfa] p-4">
                          <div className="field-grid">
                            <Field label="Product name" wide><input value={product.name} onChange={(e) => updateProduct(product.id, { name: e.target.value })} /></Field>
                            <Field label="Short label"><input value={product.tagline} onChange={(e) => updateProduct(product.id, { tagline: e.target.value })} /></Field>
                            <Field label="Badge"><input value={product.badge ?? ""} onChange={(e) => updateProduct(product.id, { badge: e.target.value })} placeholder="Most popular" /></Field>
                            <Field label="Description" wide><input value={product.description} onChange={(e) => updateProduct(product.id, { description: e.target.value })} /></Field>
                            {([1, 2, 3] as const).map((tier) => (
                              <Field key={tier} label={`${tier === 3 ? "3+" : tier}-story price / ft`}>
                                <div className="money-input"><span>$</span><input type="number" min="0" value={product.pricePerFoot[tier]} onChange={(e) => updateProduct(product.id, { pricePerFoot: { ...product.pricePerFoot, [tier]: Number(e.target.value) } })} /><small>/ ft</small></div>
                              </Field>
                            ))}
                            <Field label="Manufacturer warranty"><div className="money-input"><input type="number" min="0" value={product.warrantyYears} onChange={(e) => updateProduct(product.id, { warrantyYears: Number(e.target.value) })} /><small>years</small></div></Field>
                            <Field label="Workmanship warranty"><div className="money-input"><input type="number" min="0" value={product.workmanshipYears} onChange={(e) => updateProduct(product.id, { workmanshipYears: Number(e.target.value) })} /><small>years</small></div></Field>
                          </div>
                          <div className="mt-5 border-t border-[#e5e8e4] pt-4">
                            <b className="text-[10px] text-[#3c4a42]">Customer finish colors</b>
                            <div className="mt-3 grid gap-2 sm:grid-cols-2">
                              {product.colors.map((color) => (
                                <div key={color.id} className="flex items-center gap-2 rounded-lg border border-[#d8ded9] bg-white p-2">
                                  <input type="color" value={color.hex} onChange={(e) => updateProduct(product.id, { colors: product.colors.map((item) => item.id === color.id ? { ...item, hex: e.target.value } : item) })} className="size-8" />
                                  <input value={color.name} onChange={(e) => updateProduct(product.id, { colors: product.colors.map((item) => item.id === color.id ? { ...item, name: e.target.value } : item) })} className="min-w-0 flex-1 border-0 bg-transparent text-[9px] outline-none" />
                                  <button type="button" onClick={() => updateProduct(product.id, { colors: product.colors.filter((item) => item.id !== color.id) })} className="text-xs text-red-700">×</button>
                                </div>
                              ))}
                            </div>
                            <div className="mt-3 flex gap-2">
                              <input value={newColors[product.id]?.name ?? ""} onChange={(e) => setNewColors((current) => ({ ...current, [product.id]: { name: e.target.value, hex: current[product.id]?.hex ?? "#ffffff" } }))} placeholder="New color name" className="h-9 flex-1 rounded-md border border-[#d8ded9] bg-white px-3 text-[9px]" />
                              <input type="color" value={newColors[product.id]?.hex ?? "#ffffff"} onChange={(e) => setNewColors((current) => ({ ...current, [product.id]: { name: current[product.id]?.name ?? "", hex: e.target.value } }))} className="h-9 w-12" />
                              <button type="button" className="primary-button" onClick={() => { const color = newColors[product.id]; if (!color?.name.trim()) return; updateProduct(product.id, { colors: [...product.colors, { id: `${product.id}-${Date.now()}`, name: color.name.trim(), hex: color.hex }] }); setNewColors((current) => ({ ...current, [product.id]: { name: "", hex: "#ffffff" } })) }}>Add</button>
                            </div>
                          </div>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </SetupSection>
            )}

            {activeStep === 3 && (
              <SetupSection
                eyebrow="04 · Review & publish"
                title={saved ? "Your site is ready to launch." : "Everything look right?"}
                description={saved ? "Your configuration is saved. Create its Vercel project and connect a domain below." : "Review your company profile, coverage, and pricing before publishing."}
              >
                {saved && (
                  <div className="published-banner"><CheckCircle2 size={25} /><div><b>Configuration ready</b><p>The customer quote site is ready for a production deployment.</p></div></div>
                )}
                <div className="review-grid">
                  <ReviewCard label="Company" action={() => setActiveStep(0)}>
                    <BrandMark name={config.companyName || "Your Company"} logo={config.logo} />
                    <p>{config.phone}<br />{config.email}</p>
                  </ReviewCard>
                  <ReviewCard label="Service area" action={() => setActiveStep(1)}>
                    <strong>{config.counties.length}</strong><span>counties in {STATE_NAMES[config.state]}</span>
                    <p>{config.counties.slice(0, 4).join(", ")}{config.counties.length > 4 ? ` +${config.counties.length - 4} more` : ""}</p>
                  </ReviewCard>
                  <ReviewCard label="Gutter systems" action={() => setActiveStep(2)} wide>
                    <div className="review-products">
                      {activeProducts.map((product) => (
                        <div key={product.id}><span className="roof-dot" /><b>{product.name}</b><small>From {formatCurrency(product.pricePerFoot[1])} / linear ft</small></div>
                      ))}
                    </div>
                  </ReviewCard>
                </div>

                {saved && (
                  <section className="vercel-deploy-card">
                    <div className="vercel-deploy-card__header">
                      <span><Rocket size={19} /></span>
                      <div><b>Deploy a company site</b><p>Create or update its Vercel project, then attach the domain.</p></div>
                      <i>VERCEL</i>
                    </div>

                    <div className="deployment-fields">
                      <Field label="Vercel project name" hint="Lowercase letters, numbers, and hyphens.">
                        <input value={vercelProject} onChange={(event) => setVercelProject(projectSlug(event.target.value))} placeholder="company-gutter-quote" />
                      </Field>
                      <Field label="Custom domain" hint="Optional. DNS instructions appear after deployment.">
                        <div className="domain-input"><Globe2 size={14} /><input value={customDomain} onChange={(event) => setCustomDomain(event.target.value)} placeholder="quote.yourcompany.com" /></div>
                      </Field>
                      <Field label="Deployment key" wide hint="The private key configured by the platform owner.">
                        <input type="password" value={deployKey} onChange={(event) => setDeployKey(event.target.value)} placeholder="Enter deployment key" autoComplete="off" />
                      </Field>
                    </div>

                    {deployError && <div className="deployment-error">{deployError}</div>}

                    {deployment && (
                      <div className="deployment-success">
                        <div className="deployment-success__top">
                          <span><CheckCircle2 size={20} /></span>
                          <div><b>Production build started</b><p>{deployment.project.created ? "A new Vercel project was created." : "The existing Vercel project was updated."}</p></div>
                        </div>
                        <div className="deployment-links">
                          <a href={deployment.deployment.url} target="_blank" rel="noreferrer">Open deployment <ExternalLink size={13} /></a>
                          <a href={deployment.dashboardUrl} target="_blank" rel="noreferrer">View build in Vercel <ExternalLink size={13} /></a>
                        </div>
                        {deployment.domain && (
                          <div className={`domain-status ${deployment.domain.verified ? "is-verified" : ""}`}>
                            <div><Globe2 size={16} /><span><b>{deployment.domain.name}</b><small>{deployment.domain.verified ? "Domain verified and attached" : "Domain attached · DNS verification required"}</small></span></div>
                            {!deployment.domain.verified && deployment.domain.verification && deployment.domain.verification.length > 0 && (
                              <div className="dns-records">
                                {deployment.domain.verification.map((record, index) => (
                                  <div key={`${record.type}-${index}`}><span>{record.type || "DNS"}</span><code>{record.domain || deployment.domain?.name}</code><code>{record.value || record.reason}</code></div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    <button type="button" className="deploy-button" disabled={deploying || !vercelProject || !deployKey} onClick={deployToVercel}>
                      {deploying ? <><LoaderCircle className="spin" size={17} /> Creating production build…</> : <><Rocket size={17} /> Deploy to Vercel</>}
                    </button>
                    <p className="deployment-footnote"><ShieldCheck size={12} /> Credentials are sent only to this app’s secure server route. Your Vercel token is never exposed in the browser.</p>
                  </section>
                )}

                <div className="publish-actions">
                  <button type="button" className="secondary-button" onClick={() => { setConfig(DEFAULT_CONFIG); setSaved(false); setDeployment(null); setDeployError("") }}><RotateCcw size={16} /> Reset demo</button>
                  {saved ? (
                    <Link href="/" className="secondary-button">Open local preview <ExternalLink size={17} /></Link>
                  ) : (
                    <button type="button" className="primary-button" onClick={publish}>Save & prepare deployment <Sparkles size={17} /></button>
                  )}
                </div>
              </SetupSection>
            )}

            <footer className="setup-nav">
              <button type="button" className="secondary-button" disabled={activeStep === 0} onClick={() => setActiveStep((step) => Math.max(0, step - 1))}><ArrowLeft size={16} /> Back</button>
              {activeStep < 3 && <button type="button" className="primary-button" onClick={() => { saveCompanyConfig(config); setActiveStep((step) => Math.min(3, step + 1)) }}>Save & continue <ArrowRight size={17} /></button>}
            </footer>
          </div>

          <aside className="live-preview">
            <div className="live-preview__label"><span><i /> Live preview</span><small>Customer view</small></div>
            <div className="preview-browser">
              <div className="preview-browser__bar"><i /><i /><i /><span>yourcompany.com/quote</span></div>
              <div className="preview-site">
                <header><BrandMark name={config.companyName || "Your Company"} logo={config.logo} /><span>{config.phone || "Your phone"}</span></header>
                <div className="preview-hero">
                  <span>Instant gutter pricing</span>
                  <h2>A gutter quote.<br /><em>Without the runaround.</em></h2>
                  <p>{config.tagline || "Your company tagline goes here."}</p>
                  <div className="preview-card">
                    <small>LET’S START WITH YOUR HOME</small>
                    <b>What is your property address?</b>
                    <div>123 Main Street<MapPinned size={13} /></div>
                    <button type="button">Get my instant quote <ArrowRight size={13} /></button>
                  </div>
                </div>
                <footer><span><ShieldCheck size={12} /> No obligation</span><span>Built for homeowners</span></footer>
              </div>
            </div>
            <p className="preview-hint">Changes appear here instantly. Publish when you’re ready to test the full experience.</p>
          </aside>
        </div>
      </section>
    </main>
  )
}

function SetupSection({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="setup-section">
      <span className="eyebrow">{eyebrow}</span>
      <h2>{title}</h2>
      <p className="section-description">{description}</p>
      <div className="setup-section__body">{children}</div>
    </section>
  )
}

function Field({ label, hint, wide, children }: { label: string; hint?: string; wide?: boolean; children: React.ReactNode }) {
  return <label className={`field ${wide ? "field--wide" : ""}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <div className="color-input"><input aria-label={`${label} color picker`} type="color" value={value} onChange={(e) => onChange(e.target.value)} /><input aria-label={`${label} hex code`} value={value.toUpperCase()} onChange={(e) => onChange(e.target.value)} maxLength={7} /></div>
}

function ReviewCard({ label, action, wide, children }: { label: string; action: () => void; wide?: boolean; children: React.ReactNode }) {
  return <article className={`review-card ${wide ? "review-card--wide" : ""}`}><header><span>{label}</span><button type="button" onClick={action}>Edit</button></header><div>{children}</div></article>
}

function processLogo(file: File) {
  return new Promise<{ dataUrl: string; palette: ThemePalette }>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()

    image.onload = () => {
      const maxWidth = 480
      const maxHeight = 240
      const scale = Math.min(1, maxWidth / image.naturalWidth, maxHeight / image.naturalHeight)
      const canvas = document.createElement("canvas")
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      const context = canvas.getContext("2d")
      if (!context) {
        URL.revokeObjectURL(objectUrl)
        reject(new Error("Canvas is not available."))
        return
      }
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(objectUrl)
      resolve({ dataUrl: canvas.toDataURL("image/webp", 0.82), palette: extractLogoPalette(context, canvas) })
    }

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error("Logo could not be loaded."))
    }
    image.src = objectUrl
  })
}

function extractLogoPalette(context: CanvasRenderingContext2D, canvas: HTMLCanvasElement): ThemePalette {
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
  const colors = new Map<string, { red: number; green: number; blue: number; count: number }>()

  for (let index = 0; index < pixels.length; index += 16) {
    const alpha = pixels[index + 3]
    if (alpha < 120) continue
    const red = pixels[index]
    const green = pixels[index + 1]
    const blue = pixels[index + 2]
    const luminance = (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255
    if (luminance > 0.96) continue
    const key = `${Math.round(red / 24) * 24},${Math.round(green / 24) * 24},${Math.round(blue / 24) * 24}`
    const color = colors.get(key)
    if (color) color.count += 1
    else colors.set(key, { red, green, blue, count: 1 })
  }

  const candidates = [...colors.values()].sort((left, right) => right.count - left.count).slice(0, 28)
  if (candidates.length === 0) return { primary: "#1E3A4F", accent: "#F5A623" }

  const metrics = (color: { red: number; green: number; blue: number }) => {
    const max = Math.max(color.red, color.green, color.blue)
    const min = Math.min(color.red, color.green, color.blue)
    return {
      luminance: (color.red * 0.2126 + color.green * 0.7152 + color.blue * 0.0722) / 255,
      saturation: max === 0 ? 0 : (max - min) / max,
    }
  }
  const primary = candidates
    .filter((color) => metrics(color).luminance < 0.72)
    .sort((left, right) => {
      const leftMetrics = metrics(left)
      const rightMetrics = metrics(right)
      return right.count * (1 + rightMetrics.saturation) - left.count * (1 + leftMetrics.saturation)
    })[0] ?? candidates[0]
  const accent = candidates
    .filter((color) => color !== primary)
    .sort((left, right) => {
      const distance = (color: typeof left) => Math.hypot(color.red - primary.red, color.green - primary.green, color.blue - primary.blue)
      const leftMetrics = metrics(left)
      const rightMetrics = metrics(right)
      return distance(right) * (1 + rightMetrics.saturation) * Math.sqrt(right.count) - distance(left) * (1 + leftMetrics.saturation) * Math.sqrt(left.count)
    })[0]

  const toHex = (color: { red: number; green: number; blue: number }) =>
    `#${[color.red, color.green, color.blue].map((value) => Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0")).join("").toUpperCase()}`

  return { primary: toHex(primary), accent: accent ? toHex(accent) : metrics(primary).luminance < 0.5 ? "#F5A623" : "#1E3A4F" }
}
