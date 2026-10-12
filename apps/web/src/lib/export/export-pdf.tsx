import { Document, Page, StyleSheet, Text } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 11 },
  line: { marginBottom: 4 },
});

export function ExportPdf({ lines }: { lines: string[] }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        {lines.map((line, index) => (
          <Text key={`${index}-${line}`} style={styles.line}>
            {line}
          </Text>
        ))}
      </Page>
    </Document>
  );
}
