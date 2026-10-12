---
title: Export data
section: Setup
summary: Owners and admins download a zip of customers, properties, quotes, and invoices.
order: 5
---

## Download the zip

1. Open Settings.
2. Choose "Download CSV, JSON, and PDF exports".
3. The browser saves `lawnquoter-export.zip`.
4. Anyone who is not an owner or an admin gets "Owners and admins can export company data."

## What is in the file

The zip holds seven files:

- `accounts.csv` with id, name, type, status, email, phone, and parent account.
- `properties.csv` with the property name, address, city, region, postal code, and lot size.
- `quotes.csv` with the quote number, title, and status.
- `invoices.csv` with the invoice number, status, total in cents, and due date.
- `export.json` with the same four lists.
- `register.pdf` with the counts and up to 40 quotes.
- `invoices.pdf` with up to 40 invoices.

Each list stops at 20,000 rows. When a list hits that cap, the register PDF says so, for example "Accounts stopped at 20000 rows."
