import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

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
}: {
  payload: {
    title: string;
    number: number;
    intro: string | null;
    notes_customer: string | null;
    org: { name: string };
    items: Array<{ name: string; price: number; state: string; description: string | null }>;
  };
}) {
  const included = payload.items.filter((i) => i.state === "included");
  const total = included.reduce((s, i) => s + Number(i.price), 0);
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.brand}>{payload.org.name}</Text>
        <Text style={styles.title}>{payload.title}</Text>
        <Text style={styles.muted}>Quote #{payload.number}</Text>
        {payload.intro ? <Text style={styles.intro}>{payload.intro}</Text> : null}
        {included.map((i) => (
          <View key={i.name} style={styles.row}>
            <View>
              <Text>{i.name}</Text>
              {i.description ? <Text style={styles.muted}>{i.description}</Text> : null}
            </View>
            <Text>${Number(i.price).toFixed(2)}</Text>
          </View>
        ))}
        <Text style={styles.total}>Total ${total.toFixed(2)}</Text>
        {payload.notes_customer ? <Text style={styles.intro}>{payload.notes_customer}</Text> : null}
      </Page>
    </Document>
  );
}
