import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatMoney, formatMoneyRange } from "@/lib/money";
import { selectionFromIds, sumSelected, type SelectableItem } from "@/lib/quotes/selection";
import { pdfColors, pdfFonts, pdfMarkPath, resolvePdfBrand } from "./pdf-theme";

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontSize: 10,
    lineHeight: 1.4,
    fontFamily: pdfFonts.body,
    color: pdfColors.ink,
    backgroundColor: pdfColors.paper,
  },
  // Custom serif faces paint taller than react-pdf's line box, so these
  // texts set their own lineHeight and a margin that clears the next line.
  brand: { fontFamily: pdfFonts.heading, fontSize: 18, fontWeight: 700, lineHeight: 1.35, marginBottom: 8 },
  rule: { height: 2, marginBottom: 14 },
  title: { fontFamily: pdfFonts.heading, fontSize: 20, fontWeight: 700, lineHeight: 1.4, marginBottom: 6 },
  quoteNumber: { color: pdfColors.muted, fontSize: 8.5, lineHeight: 1.4, marginBottom: 10 },
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
  price: { fontFamily: pdfFonts.heading, fontSize: 11, fontWeight: 600, lineHeight: 1.35, fontFeatureSettings: ["tnum"] },
  otherHeading: { color: pdfColors.muted, fontSize: 8.5, lineHeight: 1.4, marginTop: 16, marginBottom: 4 },
  total: {
    marginTop: 16,
    marginBottom: 12,
    fontFamily: pdfFonts.heading,
    fontSize: 16,
    fontWeight: 700,
    lineHeight: 1.4,
    fontFeatureSettings: ["tnum"],
  },
  notes: { fontSize: 10, lineHeight: 1.4, marginBottom: 4 },
  footer: { marginTop: 28, flexDirection: "row", alignItems: "center", gap: 6 },
  mark: { width: 12, height: 12 },
  powered: { color: pdfColors.muted, fontSize: 8.5, lineHeight: 1.4 },
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

function Line({ item }: { item: PdfItem }) {
  return (
    <View style={styles.row}>
      <View style={styles.itemCopy}>
        <Text>{item.name}</Text>
        {item.description ? <Text style={styles.description}>{item.description}</Text> : null}
      </View>
      <Text style={styles.price}>{lineAmount(item)}</Text>
    </View>
  );
}

export function ProposalPdf({
  payload,
  selectedIds,
}: {
  payload: {
    title: string;
    number: number;
    intro: string | null;
    notes_customer: string | null;
    org: { name: string; brand_color?: string | null };
    items: PdfItem[];
  };
  selectedIds: string[] | null;
}) {
  const picked = new Set(selectionFromIds(payload.items, selectedIds));
  const selected = payload.items.filter((item) => picked.has(item.id));
  const others = payload.items.filter((item) => !picked.has(item.id));
  const total = sumSelected(payload.items, picked, "price");
  const brand = resolvePdfBrand(payload.org.brand_color);
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={[styles.brand, { color: brand.primary }]}>{payload.org.name}</Text>
        <View style={[styles.rule, { backgroundColor: brand.primary }]} />
        <Text style={styles.title}>{payload.title}</Text>
        <Text style={styles.quoteNumber}>Quote #{payload.number}</Text>
        {payload.intro ? <Text style={styles.intro}>{payload.intro}</Text> : null}
        {selected.map((item) => (
          <Line key={item.id} item={item} />
        ))}
        {others.length > 0 ? (
          <>
            <Text style={styles.otherHeading}>Other options</Text>
            {others.map((item) => (
              <Line key={item.id} item={item} />
            ))}
          </>
        ) : null}
        <Text style={[styles.total, { color: brand.primary }]}>Total {formatMoney(total, { cents: true })}</Text>
        {payload.notes_customer ? <Text style={styles.notes}>{payload.notes_customer}</Text> : null}
        <View style={styles.footer}>
          {/* react-pdf Image has no alt prop; the caption next to it names the mark. */}
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <Image src={pdfMarkPath} style={styles.mark} />
          <Text style={styles.powered}>Powered by LawnQuoter</Text>
        </View>
      </Page>
    </Document>
  );
}
