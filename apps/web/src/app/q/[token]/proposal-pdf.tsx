import { Document, Image, Link, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { companyInitials } from "@/lib/brand/initials";
import { deriveBrandTheme, pdfBrand } from "@/lib/brand/derive-brand-theme";
import { formatOrgAddress, headingFontOf, type PublicOrg } from "@/lib/brand/public-org";
import { formatMoney, formatMoneyRange } from "@/lib/money";
import { ESIGN_DISCLOSURES, formatNotToExceedAmount, notToExceedClause } from "@/lib/quotes/legal-copy";
import { acceptanceTotals, lineHasRange } from "@/lib/quotes/not-to-exceed";
import { selectionFromIds, type SelectableItem } from "@/lib/quotes/selection";
import {
  SITE_CHECK_AFTER_ACCEPTANCE,
  SITE_CHECK_LINE_PILL,
  SITE_CHECK_PDF_WHY_TITLE,
  hasSiteCheck,
  siteCheckCustomerBody,
  youPayNoMoreThan,
} from "@/lib/quotes/site-check";
import { pdfColors, pdfFonts, pdfHeadingFamily, pdfMarkPath } from "./pdf-theme";

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingHorizontal: 40,
    paddingBottom: 64,
    fontSize: 10,
    lineHeight: 1.4,
    fontFamily: pdfFonts.body,
    color: pdfColors.ink,
    backgroundColor: pdfColors.paper,
  },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 },
  contact: { alignItems: "flex-end", maxWidth: 240 },
  contactName: { fontSize: 11, fontWeight: 700, lineHeight: 1.35, marginBottom: 2 },
  contactLine: { color: pdfColors.muted, fontSize: 9, lineHeight: 1.4 },
  monogram: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  monogramText: { color: "#FFFFFF", fontSize: 11, fontWeight: 700, lineHeight: 1.2 },
  rule: { height: 2, marginBottom: 14 },
  title: { fontSize: 20, fontWeight: 700, lineHeight: 1.4, marginBottom: 6 },
  quoteNumber: { color: pdfColors.muted, fontSize: 8.5, lineHeight: 1.4, marginBottom: 10 },
  section: { fontSize: 11, fontWeight: 700, lineHeight: 1.35, marginBottom: 4 },
  intro: { marginBottom: 14, fontSize: 10, lineHeight: 1.4 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: pdfColors.border,
  },
  itemCopy: { flex: 1 },
  description: { color: pdfColors.muted, fontSize: 8.5, lineHeight: 1.4, marginTop: 2 },
  pill: { fontSize: 8, lineHeight: 1.3, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3, alignSelf: "flex-start", marginTop: 3 },
  price: { fontSize: 11, fontWeight: 600, lineHeight: 1.35 },
  otherHeading: { color: pdfColors.muted, fontSize: 8.5, lineHeight: 1.4, marginTop: 16, marginBottom: 4 },
  total: { marginTop: 16, marginBottom: 4, fontSize: 16, fontWeight: 700, lineHeight: 1.4 },
  estimate: { color: pdfColors.muted, fontSize: 9, lineHeight: 1.4, marginBottom: 4 },
  nteLine: { color: "#A3530A", fontSize: 9, lineHeight: 1.4, marginBottom: 4 },
  whyBox: {
    marginTop: 8,
    marginBottom: 8,
    padding: 8,
    borderRadius: 4,
    backgroundColor: "#FBF3E6",
  },
  whyTitle: { color: "#A3530A", fontSize: 10, fontWeight: 700, lineHeight: 1.35, marginBottom: 3 },
  whyBody: { color: pdfColors.ink, fontSize: 9, lineHeight: 1.4 },
  clause: { fontSize: 10, lineHeight: 1.4, marginTop: 6, marginBottom: 8 },
  sitePill: {
    fontSize: 8,
    lineHeight: 1.3,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    alignSelf: "flex-start",
    marginTop: 3,
    backgroundColor: "#FBF3E6",
    color: "#A3530A",
  },
  estUnder: { color: pdfColors.muted, fontSize: 8, lineHeight: 1.3, marginTop: 2 },
  seal: { fontSize: 8.5, lineHeight: 1.4, marginTop: 8, color: pdfColors.ink },
  notes: { fontSize: 10, lineHeight: 1.4, marginBottom: 8 },
  accept: { padding: 12, borderRadius: 6, marginTop: 8 },
  acceptTitle: { fontSize: 11, fontWeight: 700, lineHeight: 1.35, marginBottom: 2 },
  acceptCopy: { color: pdfColors.muted, fontSize: 9, lineHeight: 1.4, marginBottom: 8 },
  acceptButton: { fontSize: 10, fontWeight: 700, lineHeight: 1.3, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 4, alignSelf: "flex-start", textDecoration: "none" },
  mark: { position: "absolute", bottom: 26, right: 132, width: 10, height: 10 },
  powered: {
    position: "absolute",
    bottom: 28,
    right: 40,
    color: pdfColors.muted,
    fontSize: 8,
    lineHeight: 1.2,
  },
  pageLabel: {
    position: "absolute",
    bottom: 28,
    left: 40,
    color: pdfColors.muted,
    fontSize: 8,
    fontFamily: pdfFonts.body,
    // react-pdf turns a numeric lineHeight into points on every relayout, and the
    // page-number render prop relayouts often enough to shove the line off the sheet.
    // An empty value is ignored by that step and blocks the page's inherited line height.
    lineHeight: "",
  },
});

type PdfItem = SelectableItem & {
  name: string;
  description: string | null;
  state: string;
  range_low?: number | null;
  range_high?: number | null;
  site_check_reasons?: string[] | null;
};

function lineAmount(item: PdfItem) {
  if (item.range_low != null && item.range_high != null) {
    return formatMoneyRange(Number(item.range_low), Number(item.range_high));
  }
  return formatMoney(Number(item.price ?? 0));
}

function fitLogo(width: number | null, height: number | null) {
  const w = width && width > 0 ? width : 180;
  const h = height && height > 0 ? height : 36;
  const scale = Math.min(180 / w, 36 / h);
  return { width: Math.max(1, w * scale), height: Math.max(1, h * scale) };
}

function Line({ item, heading, brand }: { item: PdfItem; heading: string; brand: ReturnType<typeof pdfBrand> }) {
  const ranged = lineHasRange(item);
  const flagged = hasSiteCheck(item.site_check_reasons);
  return (
    <View style={styles.row}>
      <View style={styles.itemCopy}>
        <Text>{item.name}</Text>
        {item.description ? <Text style={styles.description}>{item.description}</Text> : null}
        {flagged ? <Text style={styles.sitePill}>{SITE_CHECK_LINE_PILL}</Text> : null}
        {item.state === "recommended" ? (
          <Text style={[styles.pill, { backgroundColor: brand.soft, color: brand.text }]}>Recommended</Text>
        ) : null}
        {item.state === "included" ? <Text style={styles.description}>Included</Text> : null}
      </View>
      <View>
        <Text style={[styles.price, { fontFamily: heading }]}>{lineAmount(item)}</Text>
        {ranged ? <Text style={styles.estUnder}>est. {formatMoney(Number(item.price ?? 0))}</Text> : null}
      </View>
    </View>
  );
}

export type PdfAcceptance = {
  documentHash: string;
  acceptedAt: string;
  signerName: string;
  signerEmail: string | null;
  acceptedTotal: number;
  notToExceed: number;
  hasRanges: boolean;
  clause: string | null;
  disclosureVersion: string | null;
};

export function ProposalPdf({
  payload,
  selectedIds,
  acceptance = null,
  logo,
  quoteUrl,
}: {
  payload: {
    title: string;
    number: number;
    intro: string | null;
    notes_customer: string | null;
    org: PublicOrg;
    items: PdfItem[];
  };
  selectedIds: string[] | null;
  acceptance?: PdfAcceptance | null;
  /** PNG or JPEG bytes. SVG is never passed here. */
  logo?: Buffer | null;
  quoteUrl: string;
}) {
  const picked = new Set(selectionFromIds(payload.items, selectedIds));
  const selected = payload.items.filter((item) => picked.has(item.id));
  const others = payload.items.filter((item) => !picked.has(item.id));
  const live = acceptanceTotals(payload.items, picked);
  const hasRanges = acceptance?.hasRanges ?? live.hasRanges;
  const notToExceed = acceptance?.notToExceed ?? live.notToExceed;
  const estimate = acceptance?.acceptedTotal ?? live.acceptedTotal;
  const nteLabel = formatNotToExceedAmount(notToExceed);
  const clause = hasRanges ? (acceptance?.clause ?? notToExceedClause(nteLabel)) : null;
  const selectedFlagged = selected.filter((item) => hasSiteCheck(item.site_check_reasons));
  const selectedReasons = selectedFlagged.flatMap((item) => item.site_check_reasons ?? []);
  const showSiteCheckWhy = selectedFlagged.length > 0;
  const estimateLow = selected.reduce(
    (sum, item) => sum + (lineHasRange(item) ? Number(item.range_low) : Number(item.price ?? 0)),
    0,
  );
  const estimateHigh = selected.reduce(
    (sum, item) => sum + (lineHasRange(item) ? Number(item.range_high) : Number(item.price ?? 0)),
    0,
  );
  const theme = deriveBrandTheme(payload.org.brand_color);
  const brand = pdfBrand(theme);
  const heading = pdfHeadingFamily(headingFontOf(payload.org.heading_font));
  const address = formatOrgAddress(payload.org);
  const contact = [payload.org.phone, payload.org.email].filter(Boolean).join(" · ");
  const logoBox = fitLogo(payload.org.logo_width, payload.org.logo_height);
  const totalLabel = hasRanges
    ? `Estimated total ${formatMoneyRange(estimateLow, estimateHigh)}`
    : `Total ${formatMoney(estimate, { cents: true })}`;

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text
          fixed
          style={styles.pageLabel}
          render={({ pageNumber, totalPages }) =>
            `Quote #${payload.number} · Page ${pageNumber} of ${totalPages}`
          }
        />
        <View style={styles.header}>
          {logo ? (
            // react-pdf Image has no alt; the contact block names the company.
            // eslint-disable-next-line jsx-a11y/alt-text
            <Image src={logo} style={logoBox} />
          ) : (
            <View style={[styles.monogram, { backgroundColor: brand.fill }]}>
              <Text style={[styles.monogramText, { color: brand.onFill, fontFamily: heading }]}>
                {companyInitials(payload.org.name)}
              </Text>
            </View>
          )}
          <View style={styles.contact}>
            <Text style={[styles.contactName, { color: brand.text, fontFamily: heading }]}>{payload.org.name}</Text>
            {address.map((line) => (
              <Text key={line} style={styles.contactLine}>
                {line}
              </Text>
            ))}
            {contact ? <Text style={styles.contactLine}>{contact}</Text> : null}
            {payload.org.website ? <Text style={styles.contactLine}>{payload.org.website}</Text> : null}
          </View>
        </View>
        <View style={[styles.rule, { backgroundColor: brand.fill }]} />
        <Text style={[styles.title, { fontFamily: heading }]}>{payload.title}</Text>
        <Text style={styles.quoteNumber}>Quote #{payload.number}</Text>
        {payload.intro ? <Text style={styles.intro}>{payload.intro}</Text> : null}
        {selected.length > 0 ? <Text style={[styles.section, { fontFamily: heading }]}>Your selection</Text> : null}
        {selected.map((item) => (
          <Line key={item.id} item={item} heading={heading} brand={brand} />
        ))}
        {others.length > 0 ? (
          <>
            <Text style={styles.otherHeading}>Other options</Text>
            {others.map((item) => (
              <Line key={item.id} item={item} heading={heading} brand={brand} />
            ))}
          </>
        ) : null}
        <Text style={[styles.total, { color: brand.text, fontFamily: heading }]}>{totalLabel}</Text>
        {hasRanges ? <Text style={styles.nteLine}>{youPayNoMoreThan(nteLabel)}</Text> : null}
        {showSiteCheckWhy ? (
          <View style={styles.whyBox}>
            <Text style={styles.whyTitle}>{SITE_CHECK_PDF_WHY_TITLE}</Text>
            <Text style={styles.whyBody}>{siteCheckCustomerBody(selectedReasons)}</Text>
            <Text style={[styles.whyBody, { marginTop: 4 }]}>{SITE_CHECK_AFTER_ACCEPTANCE}</Text>
          </View>
        ) : null}
        {clause ? <Text style={styles.clause}>{clause}</Text> : null}
        {acceptance ? (
          <View style={styles.seal}>
            <Text>
              Accepted by {acceptance.signerName}
              {acceptance.signerEmail ? ` (${acceptance.signerEmail})` : ""}
            </Text>
            <Text>Accepted at {acceptance.acceptedAt}</Text>
            <Text>Document hash {acceptance.documentHash}</Text>
            {acceptance.disclosureVersion ? <Text>Electronic disclosure {acceptance.disclosureVersion}</Text> : null}
          </View>
        ) : null}
        {acceptance
          ? ESIGN_DISCLOSURES.map((section) => (
              <Text key={section.id} style={styles.notes}>
                {section.heading}. {section.body}
              </Text>
            ))
          : null}
        {payload.notes_customer ? <Text style={styles.notes}>{payload.notes_customer}</Text> : null}
        {acceptance ? null : (
          <View style={[styles.accept, { backgroundColor: brand.soft }]}>
            <Text style={styles.acceptTitle}>Review and accept online</Text>
            <Text style={styles.acceptCopy}>This quote is ready for review. Accept it on the quote page.</Text>
            <Link src={quoteUrl} style={[styles.acceptButton, { backgroundColor: brand.fill, color: brand.onFill }]}>
              Accept online →
            </Link>
          </View>
        )}
        {/* eslint-disable-next-line jsx-a11y/alt-text */}
        <Image fixed src={pdfMarkPath} style={styles.mark} />
        <Text fixed style={styles.powered}>
          Powered by LawnQuoter
        </Text>
      </Page>
    </Document>
  );
}
