---
title: Customers
section: Customers
summary: Add a customer, skip duplicates, and send a portal link.
order: 10
---

## Add a customer

1. Open Accounts and choose the new-customer control.
2. Type the name, mobile, and email.
3. Start typing the service address and pick a suggestion. The button becomes Create & measure and opens the measure screen after the customer is saved.
4. Leave the address blank to choose Create. Status starts as Lead.
5. A commercial customer shows the billing fields right away. A home starts with + Billing details, which opens the same fields. You can set the company name printed on invoices, a billing email, terms, PO required, tax exempt, and consolidated invoicing.

## Payment terms

Terms are how many days after the invoice before payment is due.

- Due means the invoice is due right away.
- Net 15 and Net 30 are 15 and 30 days.
- Custom is a number from 1 to 120. Outside that range, the form says "Custom net days must be from 1 to 120."

## Duplicates

LawnQuoter looks for the same phone or the same street, city, and ZIP. When it finds a match, the form shows "Possible duplicate" and names the existing customer. Create anyway keeps this as a separate customer.

## Import a list

Sales, admins, and owners open Import customers. More than 200 rows says "Import up to 200 customers at a time." Paste a CSV with this header:

`name,phone,email,type,address_line1,city,region,postal_code`

1. Name is required.
2. Type is residential or commercial. A blank type is residential.
3. An address needs street, city, state, and ZIP, or leave all four blank.
4. A row with a matching phone or address is skipped.

## Customer portal

On the customer page, sales, admins, and owners can create a portal link.

1. Type the email that should receive the link.
2. Choose Create portal link.
3. The page shows the link even when email is not set up. The link lasts 14 days.

The customer opens that link to see their quotes and invoices.
