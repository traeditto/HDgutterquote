# GutterQuote Template

A reusable, white-label instant gutter quote experience built with Next.js. This project was created as a separate template from the original roofing and gutter quote repositories; neither source repository is modified or used as this project's Git remote.

## What is included

- Company setup studio at `/setup`
- Company name, tagline, contact details, logo upload, and selectable site colors
- Optional theme palette extraction from an uploaded company logo
- State, county, and custom-county service-area configuration
- Configurable gutter systems with separate 1-, 2-, and 3-story prices per linear foot
- Configurable downspout pricing, warranties, badges, and finish colors
- Address suggestions, aerial property confirmation, and draggable map pin
- Public GIS, property-record, building-footprint, and optional Google Solar measurement fallbacks
- Manual home-size fallback when a property cannot be measured automatically
- Lead capture and optional Resend email delivery
- Gutter color visualization using an optional Google generative image model
- Optional Meta Pixel and Conversions API tracking
- One-click Vercel project creation, production deployment, and optional custom-domain attachment

## Run locally

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000/setup` to configure a company, then open `http://localhost:3000` to test the customer quote.

## Pricing model

The quote estimates the home's gutter run from the measured building footprint. The total combines:

- the configured product price per linear foot for the selected building-height tier; and
- the configured per-downspout price for that tier.

The customer can correct the estimated linear footage and number of stories before choosing a system.

## Company configuration

The setup studio saves drafts to browser local storage. A deployed company site receives its configuration through `NEXT_PUBLIC_COMPANY_CONFIG`, so branding, coverage, products, prices, finishes, and the public Meta Pixel ID are compiled into that company's site.

Generated public company sites hide `/setup`. Before exposing the admin/template deployment to untrusted users, add authentication and persistent company records. The deployment endpoint is protected by `GUTTERQUOTE_DEPLOY_KEY`, but a production multi-tenant platform should also authorize every deployment through signed-in company accounts.

## Optional service keys

Copy `.env.example` to `.env.local` and add only the services you plan to use:

- `GOOGLE_MAPS_API_KEY` for Places autocomplete, aerial imagery, precise geocoding, and optional Solar measurements
- `GOOGLE_GENERATIVE_AI_API_KEY` for gutter color visualization
- `RESEND_API_KEY` and `LEAD_FROM` for lead emails
- `META_CAPI_ACCESS_TOKEN` and optional `META_TEST_EVENT_CODE` for server-side Meta events

The quote still provides manual fallbacks when mapping or measurement data is unavailable. Lead email and tracking failures never block the customer from seeing the estimate.

## Vercel deployment setup

The final setup step creates one Vercel project per gutter company.

1. Push **this new project** to a new GitHub repository. Do not point the integration at either original source repository.
2. Install the Vercel GitHub integration for the new template repository.
3. Configure the Vercel variables in `.env.example` on the admin/template deployment.
4. Deploy the admin/template project.
5. Complete company setup, select **Save & prepare deployment**, enter the deployment key, and select **Deploy to Vercel**.

The public company configuration is stored as a plain production environment variable. Any configured Google, Resend, and Meta server credentials are copied to the generated project as encrypted production variables; they are never sent to the browser. Each company configuration's email address is the default lead recipient.

If a custom domain requires verification, the publish screen displays the DNS record returned by Vercel.

## Validation

```bash
pnpm typecheck
pnpm build
```
