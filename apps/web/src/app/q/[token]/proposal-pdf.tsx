import { Document, Image, Link, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatMoney, formatMoneyRange } from "@/lib/money";
import { companyInitials } from "@/lib/brand/initials";
import { deriveBrandTheme, pdfBrand } from "@/lib/brand/derive-brand-theme";
import { formatOrgAddress, headingFontOf, type PublicOrg } from "@/lib/brand/public-org";
import { selectionFromIds, sumSelected, type SelectableItem } from "@/lib/quotes/selection";
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
  total: { marginTop: 16, marginBottom: 12, fontSize: 16, fontWeight: 700, lineHeight: 1.4 },
  notes: { fontSize: 10, lineHeight: 1.4, marginBottom: 8 },
  accept: { padding: 12, borderRadius: 6, marginTop: 8 },
  acceptTitle: { fontSize: 11, fontWeight: 700, lineHeight: 1.35, marginBottom: 2 },
  acceptCopy: { color: pdfColors.muted, fontSize: 9, lineHeight: 1.4, marginBottom: 8 },
  acceptButton: { fontSize: 10, fontWeight: 700, lineHeight: 1.3, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 4, alignSelf: "flex-start", textDecoration: "none" },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  footerMark: { flexDirection: "row", alignItems: "center", gap: 4 },
  mark: { width: 10, height: 10 },
  powered: { color: pdfColors.muted, fontSize: 8, lineHeight: 1.2 },
  pageLabel: { color: pdfColors.muted, fontSize: 8, lineHeight: 1.2 },
});

type PdfItem = SelectableItem & {
  name: string;
  description: string | null;
  state: string;
  range_low?: number | null;
  range_high?: number | null;
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
  return (
    <View style={styles.row}>
      <View style={styles.itemCopy}>
        <Text>{item.name}</Text>
        {item.description ? <Text style={styles.description}>{item.description}</Text> : null}
        {item.state === "recommended" ? (
          <Text style={[styles.pill, { backgroundColor: brand.soft, color: brand.text }]}>Recommended</Text>
        ) : null}
        {item.state === "included" ? <Text style={styles.description}>Included</Text> : null}
      </View>
      <Text style={[styles.price, { fontFamily: heading }]}>{lineAmount(item)}</Text>
    </View>
  );
}

export function ProposalPdf({
  payload,
  selectedIds,
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
  /** PNG or JPEG bytes. SVG is never passed here. */
  logo?: Buffer | null;
  quoteUrl: string;
}) {
  const picked = new Set(selectionFromIds(payload.items, selectedIds));
  const selected = payload.items.filter((item) => picked.has(item.id));
  const others = payload.items.filter((item) => !picked.has(item.id));
  const total = sumSelected(payload.items, picked, "price");
  const theme = deriveBrandTheme(payload.org.brand_color);
  const brand = pdfBrand(theme);
  const heading = pdfHeadingFamily(headingFontOf(payload.org.heading_font));
  const address = formatOrgAddress(payload.org);
  const contact = [payload.org.phone, payload.org.email].filter(Boolean).join(" · ");
  const logoBox = fitLogo(payload.org.logo_width, payload.org.logo_height);

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
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
        <Text style={[styles.total, { color: brand.text, fontFamily: heading }]}>Total {formatMoney(total, { cents: true })}</Text>
        {payload.notes_customer ? <Text style={styles.notes}>{payload.notes_customer}</Text> : null}
        <View style={[styles.accept, { backgroundColor: brand.soft }]}>
          <Text style={styles.acceptTitle}>Review and accept online</Text>
          <Text style={styles.acceptCopy}>This quote is ready for review. Accept it on the quote page.</Text>
          <Link src={quoteUrl} style={[styles.acceptButton, { backgroundColor: brand.fill, color: brand.onFill }]}>
            Accept online →
          </Link>
        </View>
        <View style={styles.footer} fixed>
          <Text
            style={styles.pageLabel}
            render={({ pageNumber, totalPages }) => `Quote #${payload.number} · Page ${pageNumber} of ${totalPages}`}
          />
          <View style={styles.footerMark}>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image src={pdfMarkPath} style={styles.mark} />
            <Text style={styles.powered}>Powered by LawnQuoter</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
