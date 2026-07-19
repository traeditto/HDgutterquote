# GutterQuote Template

A reusable, white-label instant gutter quote experience built with Next.js. This project was created as a separate template from the original roofing and gutter quote repositories; neither source repository is modified or used as this project's Git remote.

## What is included

- Company setup studio at `/setup`
- Production-style contractor preview mode with lead delivery and tracking disabled
- Address-test history with three successful estimates required before approval
- Approval snapshots that are invalidated when branding, coverage, products, or pricing change
- One approved customer configuration per generated GitHub repository
- Company name, tagline, contact details, logo upload, and selectable site colors
- Optional theme palette extraction from an uploaded company logo
- Nationwide service-area configuration covering all 50 states, the District of Columbia, and all 3,144 current Census county equivalents
- Contractor-selectable 6-inch, 7-inch, half-round, perforated-guard, and micro-mesh-guard systems
- Disabled reference presets for Gutter Helmet, LeafFilter, Leafguard, MasterShield, LeafBlaster Pro, RainDrop, and Englert MicroGuard
- Separate 1-, 2-, and 3-story prices per linear foot for every enabled system
- Configurable downspout pricing, warranties, badges, and finish colors
- Address suggestions, aerial property confirmation, and draggable map pin
- Public GIS, property-record, building-footprint, and optional Google Solar measurement fallbacks
- Manual home-size fallback when a property cannot be measured automatically
- Lead capture and optional Resend email delivery
- Gutter color visualization using an optional Google generative image model
- Server-enforced Gemini rendering credits with Stripe credit-pack checkout
- Protected contractor activity dashboard at `/contractor`, including abandoned address starts
- Optional Meta Pixel and Conversions API tracking
- One-click Vercel project creation, production deployment, and optional custom-domain attachment

## Run locally

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000/setup` to configure a company. After saving, use **Open completed site in test mode** to run addresses through the actual quote experience and return to Setup Studio for approval.

## Pricing model

The quote estimates the home's gutter run from the measured building footprint. For new gutter systems, the total combines:

- the configured product price per linear foot for the selected building-height tier; and
- the configured per-downspout price for that tier.

Guard-only products are priced by linear foot against the existing gutter run and do not add new downspouts.

The customer can correct the estimated linear footage and number of stories before choosing a system.

## Company configuration

The setup studio saves drafts, address-test results, and approval state to browser local storage. Test mode records successful automatic or manual estimates but skips lead delivery and Meta tracking.

After three successful address tests, contractor approval freezes a fingerprint of the exact configuration. Any later branding, coverage, product, or pricing edit invalidates that approval. Publishing creates a new repository from the template, commits the approved configuration to `company-site.json`, and connects that independent repository to its own Vercel project.

Generated customer repositories compile branding, coverage, products, prices, finishes, and the public Meta Pixel ID from `company-site.json`. Server credentials remain encrypted Vercel environment variables and are never committed to GitHub.

Branded product presets are disabled by default and provided as editable references. Contractors should enable only products they are authorized to sell and verify current manufacturer specifications, dealer terms, warranties, availability, and installed pricing before publishing.

Generated public company sites hide `/setup`. Before exposing the admin/template deployment to untrusted users, add authentication and persistent company records. The deployment endpoint is protected by `GUTTERQUOTE_DEPLOY_KEY`, but a production multi-tenant platform should also authorize every deployment through signed-in company accounts.

Generated company sites include a protected `/contractor` dashboard. Publishing creates a unique dashboard access key and shows it once; save it in the contractor's password manager. Customer addresses are recorded as soon as quote entry begins, disclosed below the address form, and expire after `ADMIN_LEAD_RETENTION_DAYS` (30 by default). Contact details appear only after the customer submits them.

## Optional service keys

Copy `.env.example` to `.env.local` and add only the services you plan to use:

- `GOOGLE_MAPS_API_KEY` for Places autocomplete, aerial imagery, precise geocoding, and optional Solar measurements
- `GOOGLE_GENERATIVE_AI_API_KEY` for gutter color visualization
- `RESEND_API_KEY` and `LEAD_FROM` for lead emails
- `META_CAPI_ACCESS_TOKEN` and optional `META_TEST_EVENT_CODE` for server-side Meta events
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` for address activity and render-credit balances
- `STRIPE_SECRET_KEY`, `STRIPE_RENDER_CREDIT_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, and `RENDER_CREDITS_PER_PACK` for prepaid rendering credit packs

The quote still provides manual fallbacks when mapping or measurement data is unavailable. Lead email and tracking failures never block the customer from seeing the estimate.

## White-label publishing setup

The final setup step creates one GitHub repository and one Vercel project per gutter company.

1. Push **this new project** to a new GitHub repository. Do not point the integration at either original source repository.
2. In GitHub repository settings, enable **Template repository** for this project.
3. Create a fine-grained GitHub token that can generate and update repositories for the configured owner.
4. Install the Vercel GitHub integration with access to newly generated customer repositories. Selecting access to all repositories is the simplest automated setup.
5. Configure the GitHub, Vercel, and publishing-key variables in `.env.example` on the admin/template deployment.
6. Deploy the admin/template project.
7. Complete company setup, save the draft, and run at least three addresses through contractor test mode.
8. Approve the tested configuration, enter unique GitHub and Vercel project names, and select **Create GitHub repository & deploy**.

Configured Google, Resend, Meta, Upstash, and Stripe server credentials are copied to the generated Vercel project as encrypted production variables; they are never committed to GitHub or sent to the browser. Each company configuration's email address is the default lead recipient.

Configure one Stripe webhook on the template/admin deployment at `/api/billing/webhook` and subscribe it to `checkout.session.completed` and `checkout.session.async_payment_succeeded`. The shared Upstash database keeps each generated company isolated under its generated tenant ID. A rendering credit is consumed server-side immediately before a Gemini image request, so browser refreshes cannot reset the paid balance.

If a custom domain requires verification, the publish screen displays the DNS record returned by Vercel.

## Validation

```bash
pnpm typecheck
pnpm build
```
