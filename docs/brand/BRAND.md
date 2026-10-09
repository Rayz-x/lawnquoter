# LawnQuoter brand: Groundwork

Established, ledger-grade, trustworthy. Deep forest green, brass, and a serif that looks right on a signed proposal.
Name is always **LawnQuoter** (capital L, capital Q, one word).

## 1. Color

Tokens live in `apps/web/src/app/globals.css` (oklch, hex in comments). Use the Tailwind utilities (`bg-primary`, `text-muted-foreground`,
`bg-brass text-brass-foreground`, `text-warning`...), never raw hex in components.

| Token | Role | Light | Dark |
|---|---|---|---|
| `--background` | Page background | `#FFFFFF` | `#0D1310` |
| `--foreground` | Body text, headings | `#121A16` | `#EBF1ED` |
| `--card` | Cards, sheets, popovers | `#FFFFFF` | `#151E19` |
| `--primary` | Forest. Main CTA (Accept quote, Save, Send), active nav, links, focus ring family | `#1E5235` | `#6CC38F` |
| `--primary-foreground` | Text/icons on primary | `#FFFFFF` | `#0B1A11` |
| `--secondary` | Low-emphasis buttons (Save draft), neutral chips | `#EBF0EC` | `#1F2A24` |
| `--muted` | Measurement bar, table header bands, disabled fills | `#F4F6F4` | `#1A241F` |
| `--muted-foreground` | Secondary text, captions, helper text | `#56625B` | `#9AA79F` |
| `--accent` | Hover/selected surface for menus, ghost buttons, command items (NOT brand gold) | `#EAF0EC` | `#22302A` |
| `--brass` | Brand gold. Recommended pill, upsell highlights, one accent rule per view | `#C8891C` | `#E2A93F` |
| `--brass-foreground` | Text on brass | `#1A1205` | `#1A1205` |
| `--brass-text` | Gold-colored text/icons on background (AA-safe) | `#8A5A0B` | `#E2A93F` |
| `--success` | Included, Accepted, Paid, synced | `#17703A` | `#5BD08A` |
| `--warning` | Pending site check, needs attention, low-confidence measurement | `#A3530A` | `#F2B84B` |
| `--destructive` | Delete, Expired, Declined, errors | `#B42318` | `#F47A6E` |
| `--destructive-foreground` | Text on destructive (white in light, dark ink in dark) | `#FFFFFF` | `#1A0705` |
| `--border` | Card/table borders, dividers | `#D9E0DB` | `#2A3530` |
| `--input` | Form field outlines (3:1 vs background) | `#88948E` | `#5F6D66` |
| `--ring` | Focus ring (used at 50% alpha by shadcn) | `#3F7A57` | `#6CC38F` |
| `--sidebar` | Office app sidebar surface | `#F4F6F4` | `#111915` |
| `--chart-1…5` | Forest, brass, sage, slate blue, umber | `#1E5235` `#C8891C` `#5E9C78` `#3D6B8C` `#8A5A0B` | `#6CC38F` `#E2A93F` `#3F8A5F` `#7FB0D4` `#C9B48A` |

**Rules**
- One primary (forest) action per view. Brass is a highlight, not a second CTA color; at most one brass element per card.
- Brass as **text** must use `text-brass-text` (`#8A5A0B` light). Plain brass `#C8891C` on white is only for fills with dark ink text.
- Status colors never carry meaning alone: always pair with a label (and a dot/icon for pending states).
- Soft status backgrounds: `color-mix(in oklch, var(--success) 12%, var(--background))` with `text-success`
  (same for warning/destructive). 12% keeps every combo ≥ 4.6:1. Don't go above 15%.
- Dark mode: destructive buttons use `text-destructive-foreground` (dark ink). White on `#F47A6E` fails contrast.

**Verified contrast (WCAG 2.x, AA = 4.5:1 text, 3:1 UI)**

| Pair (text / surface) | Light | Dark |
|---|---|---|
| foreground on background | 17.72 | 16.41 |
| foreground on card | 17.72 | 14.89 |
| muted-foreground on background | 6.38 | 7.52 |
| muted-foreground on muted | 5.87 | 6.38 |
| muted-foreground on card | 6.38 | 6.82 |
| primary-foreground on primary | 9.08 | 8.41 |
| primary on background | 9.08 | 8.80 |
| secondary-foreground on secondary | 15.36 | 12.96 |
| accent-foreground on accent | 15.34 | 12.03 |
| destructive-foreground on destructive | 6.57 | 7.30 |
| destructive on background | 6.57 | 7.03 |
| destructive on card | 6.57 | 6.38 |
| brass-foreground on brass | 6.23 | 8.81 |
| brass-text on background | 5.92 | 8.93 |
| brass-text on card | 5.92 | 8.10 |
| success-foreground on success | 6.15 | 9.59 |
| success on background | 6.15 | 9.69 |
| success on card | 6.15 | 8.80 |
| warning-foreground on warning | 5.53 | 10.36 |
| warning on background | 5.53 | 10.50 |
| warning on card | 5.53 | 9.53 |
| sidebar-foreground on sidebar | 16.32 | 15.62 |
| sidebar-primary-foreground on sidebar-primary | 9.08 | 8.41 |
| sidebar-accent-foreground on sidebar-accent | 14.79 | 12.96 |
| muted-foreground on sidebar | 5.87 | 7.16 |

Non-text UI (WCAG 1.4.11 target 3:1):
- input vs background: light 3.15, dark 3.46
- ring vs background: light 5.08, dark 8.80

## 2. Typography

- **Headings, totals, proposal titles:** Source Serif 4 (`font-heading` / `font-serif`), 600–700, tracking `-0.01em`.
- **Body, UI, tables, forms:** Source Sans 3 (`font-sans`), 400 / 600 / 700.
- **Mono (IDs, codes, API keys):** Geist Mono (`font-mono`).
- **Numbers:** every price, sq ft, hour, percentage, and total uses `tabular-nums`. Ranges use a spaced en dash: `$1,601 – $1,890`.
- The serif is for *page-level* hierarchy and money. Inside dense office UI (table headers, form labels, sidebar, buttons) stay in Source Sans 3.

| Style | Font | Size / line height | Weight | Tailwind |
|---|---|---|---|---|
| Display (marketing, OG) | Serif | 48 / 52 | 700 | `font-heading text-5xl font-bold` |
| H1 page title | Serif | 30 / 36 | 700 | `font-heading text-3xl font-bold` |
| H2 section / quote total | Serif | 24 / 32 | 600–700 | `font-heading text-2xl font-semibold` |
| H3 card title | Serif | 20 / 28 | 600 | `font-heading text-xl font-semibold` |
| Body large (public quote page) | Sans | 18 / 28 | 400 | `text-lg` |
| Body / inputs | Sans | 16 / 24 | 400 | `text-base` (inputs stay ≥16px for iOS) |
| UI / table | Sans | 14 / 20 | 400–600 | `text-sm` |
| Caption / helper / badge | Sans | 12 / 16 | 600 for badges | `text-xs` |
| Eyebrow label | Sans | 12 / 16, `tracking-wider uppercase` | 600 | `text-xs font-semibold uppercase tracking-wider` |

Crew PWA: bump body to 18px and tap targets to ≥ 44px (`.hit-expand` already exists in globals.css).

## 3. Logo

Files in `apps/web/public/brand`. The mark is a rounded-square **Q** framing mowing stripes, with a brass tail.

| File | Use |
|---|---|
| `lq-lockup-light.svg` | Mark + wordmark on light backgrounds (wordmark `#121A16`) |
| `lq-lockup-dark.svg` | On dark backgrounds (wordmark `#EBF1ED`) |
| `lq-mark.svg` | App mark, sidebar, avatars |
| `lq-mark-16.svg` | Pixel-hinted 16px |
| `lq-mark-256.png` | Raster mark for the quote PDF |

Wordmarks are outlined paths (no font dependency).

- **Clear space:** keep empty space around the logo equal to **¼ of the mark's height** on all sides (16px around a 64px mark). Nothing (text, edges, other logos) enters it.
- **Minimum size:** lockup 24px tall on screen (≈ 0.3 in / 8 mm in print). Mark: 16px using `lq-mark-16.svg`; use `lq-mark.svg` above that. The app icon is the same drawing as the old small mark.
- **Don't:** recolor the mark, put the forest tile on a busy photo, stretch it, add shadows/outlines, set "LawnQuoter" in a different font, or split it as "Lawn Quoter".
- In the app header/sidebar: mark at 24px + "LawnQuoter" in Source Serif 4 700 at 17px is fine (live text) when the SVG lockup is too wide.

## 4. Buttons

shadcn `<Button>` variants map to tokens as-is:

| Variant | Use | Example |
|---|---|---|
| `default` (forest) | The single primary action | Accept quote, Send quote, Save |
| `secondary` | Secondary actions next to a primary | Save draft, Duplicate |
| `outline` | Neutral alternatives on cards | Ask a question, Preview |
| `ghost` | Toolbar / icon buttons; hover uses `accent` | Row actions |
| `destructive` | Irreversible actions, always behind a confirm dialog | Delete quote, Remove crew member |
| `link` | Inline navigation | View PDF |
| brass (add as `variant: "brass"`: `bg-brass text-brass-foreground hover:bg-brass/90`) | Rare promotional / upsell moment, never next to a forest primary | Add recommended items, Upgrade |

Sizes: default `h-9` office, `lg` (`h-11`) for public quote page CTAs and crew PWA.

## 5. Badges (quote line states and quote status)

| State | Style | Classes (Tailwind) |
|---|---|---|
| **Included** | soft success | `bg-success/12 text-success` *(or color-mix 12% as above)* |
| **Recommended** | solid brass | `bg-brass text-brass-foreground` |
| **Optional** | outline, muted | `border border-border text-muted-foreground`; price shown as `+$310` in muted until toggled on |
| **Pending site check** | soft warning + dot | `bg-warning/12 text-warning` with a 6px `bg-current` dot |
| Accepted / Paid | solid success | `bg-success text-success-foreground` |
| Expired / Declined | soft destructive | `bg-destructive/12 text-destructive` |
| New lead | solid primary | `bg-primary text-primary-foreground` |

Pending site check also gets an inline alert on the quote (soft warning background, 1px warning-tinted border) explaining that the price is a range until verified.
Note: Tailwind `/12` opacity blends against whatever sits behind; on cards it's equivalent to the 12% mix. Contrast was checked at 12%.

## 6. Per-company branding (multi-tenant)

LawnQuoter's brand belongs to the **product** surfaces: office app, crew PWA, login, marketing, emails sent *by LawnQuoter*.
Customer-facing **quote pages, quote PDFs, the widget, and customer emails are the tenant's** and may be overridden by the company's settings:
- Tenant logo replaces the LawnQuoter lockup in the header; LawnQuoter shows only as a small "Powered by LawnQuoter" footer (muted text, mark at 16px), which can be hidden on paid tiers if we want.
- Tenant brand color overrides `--primary` / `--primary-foreground` (and `--ring`) on those routes only, e.g. a `style` on the quote page wrapper or `pdfColors.primary` in the PDF. Validate it: if white text on the tenant color is < 4.5:1, use dark ink `#121A16` as the foreground automatically.
- Status colors (success / warning / destructive) and the badge system are **not** overridable, so "Pending site check" means the same thing everywhere.
- Fonts stay Source Sans 3 / Source Serif 4 unless we add a tenant font setting later.

## 7. Quote PDFs (@react-pdf)

`pdf-theme.ts` exports `pdfColors` (hex, light only) and registers the TTFs in `fonts/` (SIL OFL; licenses included).

```ts
export const pdfColors = {
  ink: "#121A16", muted: "#56625B", border: "#D9E0DB", surface: "#F4F6F4", paper: "#FFFFFF",
  primary: "#1E5235", onPrimary: "#FFFFFF", brass: "#C8891C", onBrass: "#1A1205", brassText: "#8A5A0B",
  success: "#17703A", warning: "#A3530A", destructive: "#B42318",
  successSoft: "#E3EEE7", warningSoft: "#F4EAE2", destructiveSoft: "#F6E5E3",
};
```

PDF type: headings Source Serif 4 700 at 18–20pt, totals 16pt; body Source Sans 3 10pt / 14pt leading; captions 8.5pt muted.
Use `pdfColors.primary` for the header rule and totals, and replace it with the tenant color when one is set (section 6).
