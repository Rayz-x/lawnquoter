import { expect, test } from "@playwright/test";

test("lead to invoice with paid services mocked", async ({ page }) => {
  await page.goto("/e2e");
  await page.getByRole("button", { name: "Save lead" }).click();
  await expect(page.getByText("Lead Ada Lawn")).toBeVisible();
  await page.getByRole("button", { name: "Measure" }).click();
  await expect(page.getByText("8,000 sq ft. Imagery is mocked.")).toBeVisible();
  await page.getByRole("button", { name: "Price quote" }).click();
  await expect(page.getByText("Quote $55.00")).toBeVisible();
  await page.getByRole("button", { name: "Accept quote" }).click();
  await expect(page.getByText("Accepted")).toBeVisible();
  await page.getByRole("button", { name: "Create agreement" }).click();
  await expect(page.getByText("Agreement weekly mowing")).toBeVisible();
  await page.getByRole("button", { name: "Schedule visit" }).click();
  await expect(page.getByText("Visit 2026-04-06")).toBeVisible();
  await page.getByRole("button", { name: "Create invoice" }).click();
  await expect(page.getByText("Invoice $55.00. Not charged.")).toBeVisible();
});

test("a finished visit waits offline and then syncs", async ({ page, context }) => {
  await page.goto("/e2e");
  await expect(page.getByRole("button", { name: "Finish visit offline" })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole("button", { name: "Finish visit offline" }).click();
  await expect(page.getByText("Waiting to sync")).toBeVisible();
  await page.getByRole("button", { name: "Sync" }).click();
  await expect(page.getByText("Still offline.")).toBeVisible();
  await context.setOffline(false);
  await page.getByRole("button", { name: "Sync" }).click();
  await expect(page.getByText("Synced")).toBeVisible();
});
