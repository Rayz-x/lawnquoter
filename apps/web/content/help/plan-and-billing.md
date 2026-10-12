---
title: Plan and billing
section: Setup
summary: The monthly LawnQuoter plan stays off until a test key is added.
order: 4
---

## Choose a plan

1. Open Settings and go to Payments.
2. Find LawnQuoter plan. The card says "One flat monthly price for this company. Test mode only."
3. An owner chooses Starter, Growth, or Scale.
4. LawnQuoter sends you to Stripe to start the monthly payment, then brings you back.
5. The badge shows Incomplete, Active, Past due, or Canceled.

Only an owner sees the plan buttons. Admins can see the card.

## When billing stays off

The plan buttons stay hidden until billing is turned on. The card shows one of these notes:

- "Not connected - add STRIPE_SECRET_KEY to enable."
- "Stripe Billing stays in test mode. Use a test key." A live key does not turn the buttons on.
- "Stripe Billing is off." The test key is present and the billing switch is still off.

Customer card payments are a separate Stripe connection on the same Payments tab. That card stays off until the company connects Stripe.

## Usage

Owners and admins see Usage at the top of Settings.

- Imagery sessions count once each day the measure screen opens.
- Each saved measurement counts.

If the numbers cannot load, the row says "Could not load usage."
