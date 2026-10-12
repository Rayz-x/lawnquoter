const lead = {
  key: "lead",
  noun: "Lead",
  display: { label: "Create Lead", description: "Sends a lead to LawnQuoter." },
  operation: {
    inputFields: [
      { key: "slug", required: true, label: "Company form slug" },
      { key: "contactName", required: true, label: "Name" },
      { key: "phone", label: "Phone" },
      { key: "email", label: "Email" },
      { key: "address", label: "Address" },
    ],
    perform: async (z, bundle) => {
      const response = await z.request({
        url: `${bundle.authData.baseUrl}/api/public/leads/inbound/zapier`,
        method: "POST",
        headers: { Authorization: `Bearer ${bundle.authData.webhookSecret}` },
        body: bundle.inputData,
      });
      return response.data;
    },
  },
};

module.exports = {
  version: "1.0.0",
  platformVersion: "15.0.0",
  authentication: {
    type: "custom",
    fields: [
      { key: "baseUrl", label: "LawnQuoter URL", required: true },
      { key: "webhookSecret", label: "INBOUND_LEAD_WEBHOOK_SECRET", required: true },
    ],
  },
  creates: { [lead.key]: lead },
};
