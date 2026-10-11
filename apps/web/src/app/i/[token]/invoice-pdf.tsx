import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { formatOrgAddress, type PublicOrg } from "@/lib/brand/public-org";
import { invoiceLineCustomerCopy } from "@/lib/billing/invoice-line-copy";
import type { PublicInvoice } from "@/lib/billing/public-invoice";
import { formatMoney } from "@/lib/money";
import { pdfColors, pdfFonts } from "@/app/q/[token]/pdf-theme";

const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingHorizontal: 40,
    paddingBottom: 48,
    fontSize: 10,
    lineHeight: 1.4,
    fontFamily: pdfFonts.body,
    color: pdfColors.ink,
    backgroundColor: pdfColors.paper,
  },
  header: { marginBottom: 16 },
  orgName: { fontSize: 14, fontWeight: 700, marginBottom: 4 },
  muted: { color: pdfColors.muted, fontSize: 9, lineHeight: 1.4 },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 4 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: pdfColors.border,
  },
  total: { marginTop: 16, fontSize: 14, fontWeight: 700 },
  link: { marginTop: 12, color: pdfColors.muted, fontSize: 9 },
});

function cents(value: number): number {
  return value / 100;
}

export function InvoicePdf({
  payload,
  invoiceUrl,
}: {
  payload: PublicInvoice;
  logo?: { dataUrl: string; width: number; height: number } | null;
  invoiceUrl: string;
}) {
  const org: PublicOrg = payload.org;
  const address = formatOrgAddress(org);

  return (
    <Document title={payload.number_label ?? "Invoice"}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.orgName}>{org.name}</Text>
          {address.map((line) => (
            <Text key={line} style={styles.muted}>
              {line}
            </Text>
          ))}
          {org.email ? <Text style={styles.muted}>{org.email}</Text> : null}
          {org.phone ? <Text style={styles.muted}>{org.phone}</Text> : null}
        </View>

        <Text style={styles.title}>{payload.number_label ?? "Invoice"}</Text>
        <Text style={styles.muted}>Bill to: {payload.account_name}</Text>
        {payload.due_on ? <Text style={styles.muted}>Due {payload.due_on}</Text> : null}

        <View style={{ marginTop: 16 }}>
          {payload.lines.map((line) => {
            const copy = invoiceLineCustomerCopy({
              description: line.description,
              amountCents: line.amount_cents,
              estimateLowCents: line.estimate_low_cents,
              estimateHighCents: line.estimate_high_cents,
            });
            return (
              <View key={line.id} style={styles.row} wrap={false}>
                <Text style={{ flex: 1 }}>{copy}</Text>
                <Text>{formatMoney(cents(line.amount_cents))}</Text>
              </View>
            );
          })}
        </View>

        {payload.tax_label ? <Text style={{ ...styles.muted, marginTop: 12 }}>{payload.tax_label}</Text> : null}
        <Text style={styles.total}>Total {formatMoney(cents(payload.total_cents))}</Text>
        <Text style={styles.link}>{invoiceUrl}</Text>
      </Page>
    </Document>
  );
}
