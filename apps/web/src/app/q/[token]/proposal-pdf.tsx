import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
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
  brand: { fontFamily: pdfFonts.heading, fontSize: 18, fontWeight: 700, marginBottom: 6 },
  rule: { height: 2, marginBottom: 12 },
  title: { fontFamily: pdfFonts.heading, fontSize: 20, fontWeight: 700, marginBottom: 2 },
  muted: { color: pdfColors.muted, fontSize: 8.5, marginBottom: 10 },
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
  price: { fontFamily: pdfFonts.heading, fontSize: 11, fontWeight: 600, fontFeatureSettings: ["tnum"] },
  total: { marginTop: 16, fontFamily: pdfFonts.heading, fontSize: 16, fontWeight: 700, fontFeatureSettings: ["tnum"] },
  footer: { marginTop: 28, flexDirection: "row", alignItems: "center", gap: 6 },
  mark: { width: 12, height: 12 },
  powered: { color: pdfColors.muted, fontSize: 8.5 },
});

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
    items: Array<SelectableItem & { name: string; description: string | null; state: string }>;
  };
  selectedIds: string[] | null;
}) {
  const picked = new Set(selectionFromIds(payload.items, selectedIds));
  const total = sumSelected(payload.items, picked, "price");
  const brand = resolvePdfBrand(payload.org.brand_color);
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={[styles.brand, { color: brand.primary }]}>{payload.org.name}</Text>
        <View style={[styles.rule, { backgroundColor: brand.primary }]} />
        <Text style={styles.title}>{payload.title}</Text>
        <Text style={styles.muted}>Quote #{payload.number}</Text>
        {payload.intro ? <Text style={styles.intro}>{payload.intro}</Text> : null}
        {payload.items.map((item) => (
          <View key={item.id} style={styles.row}>
            <View style={styles.itemCopy}>
              <Text>
                {item.name}
                {picked.has(item.id) ? "" : " (not selected)"}
              </Text>
              {item.description ? <Text style={styles.muted}>{item.description}</Text> : null}
            </View>
            <Text style={styles.price}>${Number(item.price ?? 0).toFixed(2)}</Text>
          </View>
        ))}
        <Text style={[styles.total, { color: brand.primary }]}>Total ${total.toFixed(2)}</Text>
        {payload.notes_customer ? <Text style={styles.intro}>{payload.notes_customer}</Text> : null}
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
