# Technical Feasibility: Lead-to-Quote Platform for Lawn Care & Landscaping (October 2026)

Compiled 2026-10-08 from ~33 searches of vendor docs, pricing pages, terms of service, and developer portals.

## 1. Property measurement data sources and APIs

### Licensing comes first
Google Maps imagery cannot legally be the measurement substrate. The Google Maps Platform ToS prohibits tracing or digitizing "roadways, building outlines, utility posts" from the satellite base map, prohibits using Google Maps Content to train or test ML models, and the Map Tiles API policy forbids "image analysis, machine interpretation, object detection, geodata extraction." A polygon traced on Google satellite imagery does not become "Customer Data." Google is fine for geocoding, address autocomplete, and a roadmap basemap; not for the measurement canvas.

Mapbox: the July 2026 Product Terms allow tracing Mapbox Satellite "solely for non-commercial purposes" or for OSM; commercial derivative vector datasets require a separate Commercial Satellite license.

### Source-by-source
- Esri World Imagery / ArcGIS Location Platform: the pragmatic default. Esri explicitly permits users "to trace features and validate edits in the creation of vector data" from World Imagery and share that vector data. Mostly Maxar Vivid (~30-50 cm) plus higher-res contributor aerials in metros. Pricing: 2M basemap tiles free/month then $0.15/1,000, or 1,000 free basemap sessions (12 hours unlimited tiles per user) then $4/1,000 sessions. Commercial apps permitted with attribution. No caching tiles beyond HTTP headers. Caveat: get written confirmation from Esri sales for the "measure-and-store" use case before scaling.
- Nearmap: 4.4-7 cm GSD aerial, ~87-88.5% of US population, up to 3x/year. This is the imagery Deep Lawn displays. API bills tiles by MB/GB and AI features by credits; AI Feature API returns vector roofs, trees, pools, driveways, vegetation/lawn. Licensing gotcha: MSA licenses APIs for "internal business purposes"; showing imagery to tenants' end customers requires an Order Form exception. Quote-only; expect low-five-figures annually for an ISV license.
- Vexcel: 7.5 cm urban / 15 cm wide-area, 95% of US refreshed in 2026, nationwide 7.5 cm program starting Jan 2027. ISV data-program licensing, no public prices.
- EagleView: 1-2 inch GSD, strongest for roofs. Free self-serve Property Data API trials (Sept 2026). Production via subscription.
- Attentive.ai (Automeasure, now Beam AI): human-QA'd AI takeoffs in 6-48 hours. ~$32 per 10-acre site landscaping, $37 landscape+snow, plus $299 platform fee. Returns turf by mowing frequency, beds, sidewalks, trees, parking lots. Ideal for commercial bids, wrong latency for instant residential.
- Deep Lawn: direct competitor with white-label widget. $120-$1,500/month incl. 40-800 searches, overage $1.50-$2.50; API add-on $85/month (measure by address, service-area check, leads/orders, webhooks). Mulch beds "coming soon." Sells bulk measurement data.
- Google Solar API: Building Insights 10k free calls/month then $10/1,000; roof segments and footprint bounds useful for roof area, not turf. Data Layers GeoTIFFs are still Google Maps Content with the same tracing prohibitions.
- Parcels: Regrid self-serve from ~2,000 records/month included, $0.10-0.15/record overage, enterprise adds matched footprints. ReportAll tile-quota pricing. Open statewide parcels in ~10 states plus partial NY/WA via ArcGIS REST. Regrid's free Esri tile layer gives boundaries nationally; attributes paid.
- Building footprints: Overture Maps (monthly releases) conflates OSM + Microsoft + Google Open Buildings + Esri under ODbL; downloadable by bbox via `overturemaps` CLI or DuckDB on GeoParquet. Free, good enough to subtract the house from the lot.
- USGS/NAIP: public domain, 60 cm (some 30 cm), 4-band RGB+NIR (NDVI), leaf-on, 3-year cycle; `imagery.nationalmap.gov` ImageServer. Too coarse for a homeowner-facing canvas, but the only imagery you can legally train on, and NIR separates turf vs mulch vs pavement.
- OpenStreetMap: roads/sidewalks/driveway hints where mapped.

### ML turf segmentation feasibility
Feasible for a small team with caveats. Zero-shot: `segment-geospatial` (samgeo) runs SAM/HQ-SAM on GeoTIFFs with prompts and exports GeoJSON; good as a click-the-lawn assist. Fine-tuned: LandCover.ai and OpenEarthMap are public datasets; SAM 2 + LoRA land-cover adaptations exist (~69% mIoU on 9-class OpenEarthMap). No public lawn-specific model; label your own 1-3k residential parcels. Legal gate: train on NAIP or licensed Nearmap/Vexcel under an ISV agreement, never on Google/Mapbox tiles. Compute: run inference in a container (Fly/Modal/Cloud Run), not Supabase Edge Functions (2 s CPU cap).

Recommendation: Phase 1 Esri World Imagery basemap (sessions pricing) + Regrid parcel polygon + Overture footprint + Terra Draw editor; auto-prefill lot minus footprint minus driveway and let the user refine. Phase 2 license Nearmap or Vexcel for HD imagery and AI vegetation layers; use Beam AI for commercial takeoffs. Phase 3 optional NAIP-based 4-band turf/bed/hardscape model for one-click prefill. Do not build on Google or Mapbox satellite.

## 2. Browser map drawing UX

- Google Maps Drawing Library is gone (deprecated Aug 2025, removed May 2026). Google recommends Terra Draw.
- Terra Draw: headless, adapter-based (Leaflet, MapLibre, Mapbox GL, Google Maps, OpenLayers, ArcGIS). Polygon/freehand/select/edit modes, snapping. Best choice because it decouples drawing from the basemap vendor.
- mapbox-gl-draw works with MapLibre; dated vertex editing UX.
- Leaflet-Geoman free tier has snapping, cut, rotate; measurements and auto-tracing are Pro.
- Turf.js: `area`, `length`, `difference`, `intersect`, `buffer` for geodesic math; use `difference(lot, footprint)` for prefill.
- deck.gl editable layers only if rendering thousands of polygons (commercial portfolios).
- Open-source "measure my lawn" examples: Rachio `yardmapper` (draw-or-enter-manually with sq-ft callback; the right UX pattern), `TerraBound`, `drawgeo`, `leaflet-measure`.

Recommendation: MapLibre GL JS + Terra Draw (maplibre adapter) + Turf.js, Esri imagery raster source. Store GeoJSON per feature with a category (turf, bed, hardscape, edging line, drive/sidewalk, canopy). Compute client-side with Turf for instant feedback; recompute server-side in PostGIS (`ST_Area(geography)`) as the source of truth. Always offer "enter size manually."

## 3. Lead capture integrations

- Google Local Services Ads: `local_services_lead` + `local_services_lead_conversation` via Google Ads API (read-only). Needs developer token (Basic access), MCC, OAuth; one LSA campaign per account. `ProvideLeadFeedback` available.
- Angi Leads/HomeAdvisor: no public API. One-way JSON webhook (X-API-KEY) configured by Angi (crmintegrations@angi.com); "Sign in with Angi" only for approved partners. Zapier fallback.
- Thumbtack: Partner Platform, OAuth 2.0; leads are "negotiations," delivered by `NegotiationCreatedV4` webhooks + `GET /api/v4/negotiations/{id}`. Docs updated Sept 2026.
- Yelp Leads API: partner approval; OAuth 2.0; webhooks (`POST /v3/webhooks`), `GET /v3/leads/{id}`, reply endpoints.
- Facebook Lead Ads: Page `leadgen` webhook; permissions `leads_retrieval`, `pages_manage_metadata`, `pages_show_list`, `ads_management`; App Review required.
- Google Business Profile messaging: dead (chat discontinued July 2024; Q&A API Nov 2025).
- Call tracking: CallRail API free to 1,500 calls/mo, $80/mo to 12k; call-complete webhooks. Twilio DIY ~$1.15/number, $0.0085/min inbound, $0.0025/min recording.
- SMS: Twilio/Telnyx require A2P 10DLC. Low-volume brand $4 one-time, $15 campaign vetting, $1.50-$10/mo per campaign; campaign review 10-15 days. As an ISV you register one brand per tenant under your CSP; collect EIN at onboarding.
- Website widget: embeddable `<script>` + iframe to a tenant-scoped public route; postMessage for height/events.
- Zapier/Make: Zapier public app requires REST Hook subscribe/unsubscribe + `performList` sample endpoint; Make requires review.

Recommendation: launch with owned channels (widget, Twilio SMS, Facebook Lead Ads, CallRail webhooks) plus a generic inbound webhook and Zapier app. Add Google LSA and Thumbtack next; pursue Yelp and Angi partner status with tenant volume. Budget 3-4 weeks wall-clock for 10DLC and Meta App Review.

## 4. Quote delivery and acceptance

E-signature 2026 list prices: SignWell from $0.85/doc (25 free API docs/mo, $0.20 at volume, no minimum); BoldSign $0.75/envelope with $30/mo minimum; Dropbox Sign API $75/mo for 50; DocuSign Developer $50/mo for 40 envelopes; Documenso AGPL self-hostable. For quote acceptance a self-built click-to-accept is legally sufficient under ESIGN/UETA if you capture: affirmative action tied to the exact document version (hash), signer identity/attribution (email/SMS magic link), timestamp, IP/user-agent, the consumer ESIGN disclosure (right to paper, right to withdraw, hardware/software requirements) and its acceptance, and an append-only hash-chained audit trail retained with a sealed PDF. Reserve SignWell for formal commercial contracts.

Payments: Stripe Connect with connected accounts per tenant (Express), destination or direct charges, application fees. Card-on-file and ACH: `SetupIntent` with `us_bank_account` + Financial Connections instant verification. Deposits = `PaymentIntent` with `setup_future_usage`. Connect self-managed pricing $2/mo per active account + 0.25% + $0.25 per payout.

PDF: `@react-pdf/renderer` in a Node route handler (~100 ms, no Chromium); avoids puppeteer bundle limits, cold starts, missing fonts on Vercel. Gotenberg only if pixel-perfect HTML/map screenshots are later required; host on Fly/Railway. Map images for PDFs: render MapLibre canvas to PNG client-side and upload to Storage.

Email: Resend ($0 for 3k/mo, $20 for 50k, React Email) for DX; Postmark if deliverability troubleshooting matters more. Per-tenant sending subdomains with DKIM/SPF/DMARC and a shared "via" fallback.

## 5. Handoff integrations

- Jobber: public GraphQL API, OAuth 2.0, 60-minute tokens with refresh rotation. `clientCreate`, `propertyCreate`, `quoteCreate` + line items (deposit supported), `requestCreate`, webhooks. Draft apps for <=5 accounts; Marketplace requires App Review.
- QuickBooks Online: REST, OAuth 2.0, `POST /v3/company/{realmId}/estimate`, convert to Invoice. 500 req/min/realm. Production keys require Intuit app assessment (1-3 weeks). Refresh tokens 100-day rolling; pin `minorversion=75`. Sub-customers (Job) support per-site mapping.
- Housecall Pro: public REST API with customers, estimates, jobs, Create Lead; only for MAX plan, API key, no OAuth.
- Service Autopilot: closed; partner-only or CSV.
- LMN: no public API; Zapier only.

Recommendation: QuickBooks Online first (accounting handoff is universal); Jobber integration only if positioning as a quoting front-end for Jobber shops; CSV/Zapier for the rest.

## 6. Build stack sanity check (Next.js + Supabase + shadcn/ui + Vercel)

Tenancy and RLS
- `tenant_id`/`org_id` on every table including children. Enable and FORCE RLS; revoke default grants on exposed schemas and grant per table.
- Stamp org and role into `app_metadata` via the Custom Access Token Hook; read in policies as `(select auth.jwt()) -> 'app_metadata' ->> 'org_id'`. Never read `user_metadata`. Wrap `auth.uid()`/`auth.jwt()` in `(select ...)` (171 ms -> <0.1 ms on 100k rows).
- Every policy needs both `USING` and `WITH CHECK`, scoped `TO authenticated`.
- JWT claims are stale until refresh; for staff removal use a membership-table check or force refresh. Multi-org users need an active-org switch that re-mints the token.
- B-tree index every `org_id` and policy filter column. Test with `EXPLAIN (ANALYZE, BUFFERS)` as role `authenticated` with `request.jwt.claims` set.
- pgTAP deny tests in CI.

PostGIS
- `geography(Polygon, 4326)` for areas; expose via `.geojson()` or RPC returning `ST_AsGeoJSON`. GiST indexes compose with RLS filters.
- PostGIS lives in `extensions` schema; qualify functions in `SECURITY DEFINER` functions with `set search_path = ''`.
- Public homeowner quote pages must use a signed-token RPC, not the anon role scanning tenant tables.

Compute
- Supabase Edge Functions: 256 MB, 2 s CPU per request; not for PDF or ML. Vercel functions: 300 s default, up to 800 s Pro, 4 GB; fine for react-pdf and orchestration. Segmentation model on a container host.
- Realtime: 500 peak connections on Pro then $10/1,000; fine for dispatch, keep off the public widget.
- Storage: tenant-prefixed buckets with RLS on `storage.objects`; signed URLs for PDFs.

Vendor-lock risks: Esri/Nearmap imagery terms and 10DLC per-tenant registration are the operational dependencies that most need contracts and onboarding UX.

## Sources

Measurement & imagery: softwarefinder.com Attentive.ai; Attentive freshdesk platform fee; attentive.ai automeasure blueprint takeoffs; deeplawn.com (pricing, bulk-data-&-api, onlinesales); developer.nearmap.com (about, tile-api, transactional-content-api); help.nearmap.com classic vs current; nearmap.com legal (MSA, product terms), coverage; developer.eagleview.com property-data getting started; eagleview.com self-serve trials announcement; vexceldata.com (platform, US collection, nationwide 7.5cm); developers.google.com/maps billing-and-pricing (pricing, sku-details); mapsplatform.google.com solar; developers.google.com/maps solar building-insights; cloud.google.com/maps-platform/terms and maps-service-terms; developers.google.com/maps/documentation/tile/policies; mapbox.com (pricing, imagery), docs.mapbox.com raster-tiles, Mapbox Product Terms July 2026; location.arcgis.com (pricing, licensing-and-attribution); esri.com basemap sessions blog; arcgis.com World Imagery item 8e90a00a0a6845a49262e0b756f57a10; esri.com platform-legal PDF; support.regrid.com (getting-started-api, plan-options); app.regrid.com/reports/parcels; reportallusa.com (api, overlay docs); gis.ny.gov/parcels; docs.overturemaps.org (buildings, attribution); imagery.nationalmap.gov USGSNAIPImagery ImageServer; usgs.gov NAIP; github.com/opengeos/segment-geospatial; github.com/Nandini-Prasadd/LULCusingSAM2; arxiv.org/abs/2005.02264; digitalcommons.lmu.edu CATE article 1136.
Drawing UX: developers.google.com/maps/deprecations; github.com/mapchannels/mcx-drawing-polyfill; github.com/JamesLMilner/terra-draw; docs.mapbox.com mapbox-gl-draw example; maplibre.org draw-polygon example; geoman.io leaflet-geoman vs leaflet-draw; github.com/ljagis/leaflet-measure; github.com/Rachio/yardmapper; github.com/crizmo/TerraBound; github.com/kayes360/drawgeo.
Lead capture: developers.google.com/google-ads/api local-service-campaigns, access-levels; intercom.help/angi CRM integration; github.com/api-evangelist/angi; developers.thumbtack.com negotiations; docs.developer.yelp.com partner-integration-guide; developers.facebook.com webhooks-for-leadgen; Google Business Messages sunset notes; support.callrail.com (API, webhooks); twilio.com a2p-10dlc and quickstart; support.telnyx.com 10dlc fees; docs.zapier.com hook-trigger and publishing requirements; developers.make.com app review.
Quote delivery: sign.dropbox.com API pricing; ecom.docusign.com developer plans; contractflash.com e-signature API pricing; chaindoc.io esignature API guide; uscode.house.gov 15 USC ch. 96; esignrecords.org ESRA standard; useanvil.com audit trail schema; docs.stripe.com (connect app-fees, platform-pricing-tools, ACH set-up-payment, direct charges multiple accounts); shipgarden.com gotenberg vs puppeteer vs react-pdf; pdf4.dev PDF on Vercel; resend.com/pricing; postmarkapp.com compare; simplesends.com transactional pricing.
Handoff: developer.getjobber.com (docs, queries and mutations, app review); help.housecallpro.com (API overview, API leads in Job Inbox); docs.housecallpro.com; supergood.ai Service Autopilot API report card; apideck.com, satvasolutions.com, inboxledger.app QuickBooks Online API guides.
Stack: supabase.com docs (row-level-security, RLS performance, custom-access-token-hook, postgis, functions limits, realtime pricing); supabase-js PostgrestTransformBuilder `.geojson()`; geospatial-api.com multi-tenant PostGIS RLS; blog.rowistan.com (RLS query plan debugging, custom JWT claims); tomodahinata.com Supabase RLS multi-tenancy patterns; vercel.com/docs/functions/limitations.
