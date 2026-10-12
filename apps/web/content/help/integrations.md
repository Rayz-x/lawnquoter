---
title: Integrations
section: Settings
summary: What each connection does, and that it stays off until its key is added.
order: 73
---

## Each one stays off until its key is added

Open Settings. Each card below sits on the tab named in its section. A missing key leaves the feature off. Adding a key does not start a sync, a charge, or a lead fetch by itself.

## QuickBooks

On Settings, Payments. Two-way sync for customers, invoices, and payments. Sites map to sub-customers. Until the key is set, the card says "Not connected - add a QuickBooks key to enable."

When the key is set, open Sync log and conflicts and choose Connect QuickBooks. Until that connection exists, sync says "Connect QuickBooks before invoices can sync."

## Stripe

On Settings, Payments. Stripe Connect takes deposits and card payments. Money goes to your Stripe account. See [Payments](/help/payments).

The LawnQuoter plan is a separate Stripe Billing connection and stays in test mode. See [Plan and billing](/help/plan-and-billing).

## SignWell

From a commercial quote. SignWell sends the contract for signature. Until the key is set, signature requests say "Not connected - add a SignWell key to enable." Requests stay in test mode.

## Wisetack

On Settings, Payments. Wisetack puts a financing link on proposals of $500 or more. Until the key is set, the card says "Not connected - add a Wisetack key to enable." When it is on, those proposals include the link.

## Lead connectors

On Settings, Lead form. Owners only. The card says "Each source stays off until its key is set. Nothing is fetched or charged before then."

The sources are Google Local Services, Thumbtack, Yelp, Angi, Zapier, and Facebook Lead Ads. Facebook uses three keys: the app secret, the verify token, and the page token. Each row stays off until that key is set.

A connected source says Connected. A missing key names the key to add. Adding a key does not fetch leads by itself.

## Imagery

On the measure screen for a property. Nearmap, Vexcel, and segmentation each stay off until that key is saved.

- Nearmap off: "Not connected - add NEARMAP_API_KEY to enable". With a key: "Nearmap key saved. HD imagery stays off."
- Vexcel off: "Not connected - add VEXCEL_API_KEY to enable". With a key: "Vexcel key saved. HD imagery stays off."
- Segmentation off: "Not connected - add SEGMENTATION_API_KEY to enable". With a key: "Segmentation key saved. Segmentation stays off."

A saved key does not call those services on its own. HD imagery and automatic lot tracing stay off.
