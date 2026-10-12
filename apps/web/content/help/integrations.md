---
title: Integrations
section: Settings
summary: What each connection does, and that it stays off until its key is added.
order: 73
---

## Each one stays off until its key is added

Open Settings, Payments, for the cards below. A missing key leaves the feature off. Adding a key does not start a sync or a charge by itself.

## QuickBooks

Two-way sync for customers, invoices, and payments. Sites map to sub-customers. Until the key is set, the card says "Not connected - add a QuickBooks key to enable." Sync log and conflicts is the page where you review a sync.

## Stripe

Stripe Connect takes deposits and card payments. Money goes to your Stripe account. See [Payments](/help/payments).

The LawnQuoter plan is a separate Stripe Billing connection and stays in test mode. See [Plan and billing](/help/plan-and-billing).

## SignWell

SignWell sends a commercial contract for signature. Until the key is set, signature requests say "Not connected - add a SignWell key to enable." Requests stay in test mode.

## Wisetack

Wisetack puts a financing link on proposals of $500 or more. Until the key is set, the card says "Not connected - add a Wisetack key to enable." When it is on, those proposals include the link.

## Imagery

Nearmap, Vexcel, and segmentation each stay off until that key is saved.

- Nearmap off: "Not connected - add NEARMAP_API_KEY to enable". With a key: "Nearmap key saved. HD imagery stays off."
- Vexcel off: "Not connected - add VEXCEL_API_KEY to enable". With a key: "Vexcel key saved. HD imagery stays off."
- Segmentation off: "Not connected - add SEGMENTATION_API_KEY to enable". With a key: "Segmentation key saved. Segmentation stays off."

A saved key does not call those services on its own. HD imagery and automatic lot tracing stay off.
