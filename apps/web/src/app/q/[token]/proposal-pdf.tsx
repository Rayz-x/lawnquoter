import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { selectionFromIds, sumSelected, type SelectableItem } from "@/lib/quotes/selection";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 11, fontFamily: "Helvetica" },
  brand: { fontSize: 10, color: "#166534", marginBottom: 4 },
  title: { fontSize: 20, marginBottom: 4 },
  muted: { color: "#666", marginBottom: 12 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottom: "1px solid #eee" },
  total: { marginTop: 16, fontSize: 14, fontFamily: "Helvetica-Bold" },
  intro: { marginBottom: 16, lineHeight: 1.4 },
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
    org: { name: string };
    items: Array<SelectableItem & { name: string; description: string | null; state: string }>;
  };
  selectedIds: string[] | null;
}) {
  const picked = new Set(selectionFromIds(payload.items, selectedIds));
  const total = sumSelected(payload.items, picked, "price");
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.brand}>{payload.org.name}</Text>
        <Text style={styles.title}>{payload.title}</Text>
        <Text style={styles.muted}>Quote #{payload.number}</Text>
        {payload.intro ? <Text style={styles.intro}>{payload.intro}</Text> : null}
        {payload.items.map((item) => (
          <View key={item.id} style={styles.row}>
            <View>
              <Text>
                {item.name}
                {picked.has(item.id) ? "" : " (not selected)"}
              </Text>
              {item.description ? <Text style={styles.muted}>{item.description}</Text> : null}
            </View>
            <Text>${Number(item.price ?? 0).toFixed(2)}</Text>
          </View>
        ))}
        <Text style={styles.total}>Total ${total.toFixed(2)}</Text>
        {payload.notes_customer ? <Text style={styles.intro}>{payload.notes_customer}</Text> : null}
      </Page>
    </Document>
  );
}
