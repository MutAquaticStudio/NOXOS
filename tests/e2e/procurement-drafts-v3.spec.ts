import { build } from "esbuild";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const [width, theme, density] of [
  [1440, "DARK", "DEFAULT"],
  [1024, "LIGHT", "COMPACT"],
  [768, "DARK", "COMFORTABLE"],
  [390, "LIGHT", "DEFAULT"],
  [320, "DARK", "DEFAULT"]
] as const)
  test(`Procurement draft retention and tenant isolation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const bundle = await build({
      stdin: {
        loader: "tsx",
        resolveDir: resolve("apps/nox-os/src"),
        contents: `
    import {createRoot} from 'react-dom/client';
    import {useState} from 'react';
    import {NoxShell} from '@nox-os/ui';
    import '../../../packages/ui/src/styles.css';
    import {ProcurementExperience} from './procurement';
    const grants=['read','supplier.manage','purchase-order.create','purchase-order.approve','purchase-order.close','purchase-order.cancel','receipt.create','receipt.post','receipt.cancel','offer.manage'].map(p=>'module.procurement.'+p);
    window.calls=[];
    async function api(path,options={}){window.calls.push({path,...options});if(options.method)return new Promise((resolve,reject)=>window.rejectCommand=()=>reject(Error('Private SQL diagnostic')));return {suppliers:[{id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',supplierCode:'SUP-CHECK',displayName:'Supplier check',legalName:'Fixture supplier',status:'ACTIVE'}],offers:[],purchaseOrders:[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',poNumber:'PO-CHECK',supplierDisplayName:'Test supplier',status:'DRAFT',currencyCode:'USD',updatedAt:'2026-09-08T00:00:00Z',lines:[]},{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',poNumber:'PO-CLOSE',supplierDisplayName:'Test supplier',status:'RECEIVED',currencyCode:'USD',updatedAt:'2026-09-08T00:00:00Z',lines:[]}],goodsReceipts:[{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',receiptNumber:'GR-CHECK',purchaseOrderNumber:'PO-CHECK',supplierDisplayName:'Test supplier',status:'DRAFT',lines:[]}],locations:[]};}
    function App(){const [tenant,setTenant]=useState('tenant-a');window.switchTenant=setTenant;const [allowed,setAllowed]=useState(grants);window.setPermissions=setAllowed;
      return <NoxShell theme="${theme}" density="${density}" activeRoute="/procurement" railItems={[]} onNavigate={()=>{}} onUnsavedChange={dirty=>window.dirty=dirty}>
      <ProcurementExperience api={api} tenantId={tenant} modulePermissions={allowed}/></NoxShell>;}
    const registryApi=api;
    const originalApi=async(path,options)=>{if(path==='/inventory/locations' && window.denyLocations)throw Error('Private inventory denial');return registryApi(path,options);};
    api=async(path,options={})=>{if(window.succeedWrites && options.method){window.calls.push({path,...options});return {};}if(window.failReads && !options.method)throw Error('Private read diagnostic');const result=await originalApi(path,options);if(!options.method){result.purchaseOrders[0].lines=[{id:'line-one',supplierMaterialNameSnapshot:'Material reference',orderedQuantityMg:'1000000',receivedQuantityMg:'250000',remainingQuantityMg:'750000',unitPricePerKg:'12.50'}];}return result;};
    createRoot(document.getElementById('root')).render(<App/>);
  `
      },
      bundle: true,
      write: false,
      outfile: "procurement-drafts.js",
      platform: "browser",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' }
    });
    await page.route("**/*", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Procurement drafts</title></head><body><div id="root"></div></body></html>'
      })
    );
    await page.goto("/procurement");
    for (const file of bundle.outputFiles)
      if (file.path.endsWith(".css")) await page.addStyleTag({ content: file.text });
      else await page.addScriptTag({ content: file.text });
    await expect(page).toHaveTitle("Procurement drafts");
    await expect(page.locator(".nox-os")).toHaveAttribute("data-theme", theme);
    await expect(page.locator(".nox-os")).toHaveAttribute("data-density", density);
    const poTab = page.getByRole("tab", { name: "Purchase Orders", exact: true });
    await poTab.focus();
    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: "Supplier Offers", exact: true })).toBeFocused();
    await expect(
      page.getByRole("tabpanel", { name: "Supplier Offers", exact: true })
    ).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(poTab).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("tab", { name: "Supplier Offers", exact: true })).toBeFocused();
    await page.keyboard.press("Home");
    await expect(poTab).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByRole("tabpanel", { name: "Purchase Orders", exact: true })
    ).toBeVisible();
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Confirm Procurement action" })).toContainText(
      "PO-CHECK"
    );
    await expect(page.getByRole("region", { name: "Affected lines" })).toContainText(
      "1000000 mg ordered"
    );
    await expect(page.getByRole("region", { name: "Affected lines" })).toContainText(
      "250000 mg received"
    );
    await expect(page.getByRole("region", { name: "Affected lines" })).toContainText(
      "750000 mg remaining"
    );
    await expect(page.getByRole("region", { name: "Affected lines" })).toContainText(
      "12.50 USD / kg"
    );
    expect(
      (await new AxeBuilder({ page }).analyze()).violations.filter((item) =>
        ["serious", "critical"].includes(item.impact ?? "")
      )
    ).toEqual([]);
    mkdirSync("/tmp/nox-ui-v3", { recursive: true });
    await page.screenshot({ path: `/tmp/nox-ui-v3/procurement-confirm-${width}.png` });
    await page.getByRole("button", { name: "Cancel action", exact: true }).click();
    expect(
      await page.evaluate(() => (window as any).calls.filter((call: any) => call.method))
    ).toEqual([]);
    await page.getByLabel("PO Number", { exact: true }).fill("DRAFT-PO");
    await page
      .getByRole("form", { name: "Create Purchase Order", exact: true })
      .screenshot({ path: `/tmp/nox-ui-v3/procurement-po-form-${width}.png` });
    await expect.poll(() => page.evaluate(() => (window as any).dirty)).toBe(true);
    await page.getByRole("tab", { name: "Suppliers", exact: true }).click();
    await expect(page.getByLabel("PO Number", { exact: true })).toBeHidden();
    await page.getByLabel("Supplier Code", { exact: true }).fill("DRAFT-SUPPLIER");
    await page
      .getByRole("form", { name: "Create Supplier", exact: true })
      .screenshot({ path: `/tmp/nox-ui-v3/procurement-supplier-form-${width}.png` });
    await page.getByRole("tab", { name: "Purchase Orders", exact: true }).click();
    await expect(page.getByLabel("PO Number", { exact: true })).toHaveValue("DRAFT-PO");
    await page.getByLabel("PO Number", { exact: true }).fill("");
    await expect.poll(() => page.evaluate(() => (window as any).dirty)).toBe(true);
    await page.getByRole("tab", { name: "Suppliers", exact: true }).click();
    await expect(page.getByLabel("Supplier Code", { exact: true })).toHaveValue("DRAFT-SUPPLIER");
    await page.getByLabel("Supplier Code", { exact: true }).fill("");
    await expect.poll(() => page.evaluate(() => (window as any).dirty)).toBe(false);
    await page.getByRole("tab", { name: "Goods Receipts", exact: true }).click();
    await page.getByLabel("Receipt Number", { exact: true }).fill("DRAFT-RECEIPT");
    await page
      .getByRole("form", { name: "Create Goods Receipt", exact: true })
      .screenshot({ path: `/tmp/nox-ui-v3/procurement-receipt-form-${width}.png` });
    await page.getByRole("tab", { name: "Supplier Offers", exact: true }).click();
    const offerForm = page.getByRole("form", { name: "Create Supplier Offer" });
    await offerForm.getByLabel("Supplier SKU", { exact: true }).fill("DRAFT-SKU");
    await offerForm.screenshot({ path: `/tmp/nox-ui-v3/procurement-offer-form-${width}.png` });
    expect(await offerForm.evaluate((form) => form.scrollWidth <= form.clientWidth)).toBe(true);
    await page.getByRole("tab", { name: "Goods Receipts", exact: true }).click();
    await expect(page.getByLabel("Receipt Number", { exact: true })).toHaveValue("DRAFT-RECEIPT");
    await page.getByLabel("Receipt Number", { exact: true }).fill("");
    await expect.poll(() => page.evaluate(() => (window as any).dirty)).toBe(true);
    await page.getByRole("tab", { name: "Supplier Offers", exact: true }).click();
    await expect(offerForm.getByLabel("Supplier SKU", { exact: true })).toHaveValue("DRAFT-SKU");
    await offerForm.getByLabel("Supplier SKU", { exact: true }).fill("");
    await expect.poll(() => page.evaluate(() => (window as any).dirty)).toBe(false);
    await page.getByRole("tab", { name: "Suppliers", exact: true }).click();
    await page.getByLabel("Supplier Code", { exact: true }).fill("TENANT-A-ONLY");
    await page.evaluate(() => (window as any).switchTenant("tenant-b"));
    await page.getByRole("tab", { name: "Suppliers", exact: true }).click();
    await expect(page.getByLabel("Supplier Code", { exact: true })).toHaveValue("");
    await expect.poll(() => page.evaluate(() => (window as any).dirty)).toBe(false);
    expect(
      await page.evaluate(() => (window as any).calls.filter((call: any) => call.method))
    ).toEqual([]);
    await page.getByLabel("Supplier Code", { exact: true }).fill("NEW");
    await page.getByLabel("Legal Name", { exact: true }).fill("Test supplier");
    await page.getByLabel("Display Name", { exact: true }).fill("Test supplier");
    await page.getByRole("form", { name: "Create Supplier", exact: true }).evaluate((form) => {
      (form as HTMLFormElement).requestSubmit();
      (form as HTMLFormElement).requestSubmit();
    });
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).calls.filter((call: any) => call.method).length)
      )
      .toBe(1);
    await expect(page.getByRole("button", { name: "Create Supplier", exact: true })).toBeDisabled();
    await page.evaluate(() => (window as any).rejectCommand());
    await expect(page.getByRole("status").filter({ hasText: "outcome is unknown" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Private SQL");
    await page.getByRole("button", { name: "Refresh records without resubmitting" }).click();
    await expect(page.getByRole("button", { name: "Create Supplier", exact: true })).toBeDisabled();
    expect(
      await page.evaluate(() => (window as any).calls.filter((call: any) => call.method).length)
    ).toBe(1);
    await page.evaluate(() => (window as any).switchTenant("tenant-c"));
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "Confirm Procurement action" });
    await expect(confirmation).toContainText("does not receive inventory");
    expect(
      await page.evaluate(() => (window as any).calls.filter((call: any) => call.method).length)
    ).toBe(1);
    await confirmation.getByRole("button", { name: "Confirm approve", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).calls.filter((call: any) => call.method).length)
      )
      .toBe(2);
    const last = await page.evaluate(() =>
      (window as any).calls.filter((call: any) => call.method).at(-1)
    );
    expect(last).toMatchObject({
      path: "/procurement/purchase-orders/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/approve",
      tenantId: "tenant-c",
      method: "POST"
    });
    await page.evaluate(() => (window as any).rejectCommand());
    let writes = 2;
    for (const [view, row, action, id, kind, effect] of [
      [
        "Purchase Orders",
        "purchase-order-PO-CHECK",
        "cancel",
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "purchase-orders",
        "does not reverse posted inventory"
      ],
      [
        "Purchase Orders",
        "purchase-order-PO-CLOSE",
        "close",
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "purchase-orders",
        "receipt history remains unchanged"
      ],
      [
        "Goods Receipts",
        "goods-receipt-GR-CHECK",
        "post",
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        "goods-receipts",
        "This changes stock"
      ],
      [
        "Goods Receipts",
        "goods-receipt-GR-CHECK",
        "cancel",
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        "goods-receipts",
        "does not reverse posted inventory"
      ]
    ]) {
      const tenant = `tenant-${writes}`;
      await page.evaluate((tenant) => (window as any).switchTenant(tenant), tenant);
      await page.getByRole("tab", { name: view, exact: true }).click();
      const trigger = page.getByTestId(row).getByRole("button", { name: action, exact: false });
      await trigger.click();
      await expect(confirmation).toContainText(effect);
      await confirmation.getByRole("button", { name: "Cancel action", exact: true }).click();
      expect(
        await page.evaluate(() => (window as any).calls.filter((call: any) => call.method).length)
      ).toBe(writes);
      await trigger.click();
      await confirmation.getByRole("button", { name: `Confirm ${action}`, exact: true }).click();
      writes++;
      await expect
        .poll(() =>
          page.evaluate(() => (window as any).calls.filter((call: any) => call.method).length)
        )
        .toBe(writes);
      expect(
        await page.evaluate(() => (window as any).calls.filter((call: any) => call.method).at(-1))
      ).toMatchObject({
        path: `/procurement/${kind}/${id}/${action}`,
        tenantId: tenant,
        method: "POST"
      });
      await page.evaluate(() => (window as any).rejectCommand());
    }
    for (const action of ["hold", "archive"]) {
      await page.evaluate((tenant) => (window as any).switchTenant(tenant), `supplier-${action}`);
      await page.getByRole("tab", { name: "Suppliers", exact: true }).click();
      await page.getByRole("button", { name: action, exact: false }).click();
      await expect(confirmation).toContainText("Supplier check");
      await confirmation.getByRole("button", { name: "Cancel action", exact: true }).click();
      expect(
        await page.evaluate(() => (window as any).calls.filter((call: any) => call.method).length)
      ).toBe(writes);
      await page.getByRole("button", { name: action, exact: false }).click();
      await confirmation.getByRole("button", { name: `Confirm ${action}`, exact: true }).click();
      writes++;
      await expect
        .poll(() =>
          page.evaluate(() => (window as any).calls.filter((call: any) => call.method).length)
        )
        .toBe(writes);
      expect(
        await page.evaluate(() => (window as any).calls.filter((call: any) => call.method).at(-1))
      ).toMatchObject({
        path: "/procurement/suppliers/dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        method: "PUT",
        body: { status: action === "hold" ? "HOLD" : "ARCHIVED" }
      });
      await page.evaluate(() => (window as any).rejectCommand());
    }
    await page.evaluate(() => (window as any).switchTenant("tenant-revoked"));
    await page.getByRole("button", { name: "Approve", exact: true }).click();
    await page.evaluate(() => (window as any).setPermissions(["module.procurement.read"]));
    await confirmation.getByRole("button", { name: "Confirm approve", exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as any).calls.filter((call: any) => call.method).length)
    ).toBe(writes);
    await page.evaluate(() => {
      (window as any).succeedWrites = true;
      (window as any).switchTenant("tenant-success");
      (window as any).setPermissions(
        ["read", "purchase-order.create", "offer.manage"].map((p) => "module.procurement." + p)
      );
    });
    const poForm = page.getByRole("form", { name: "Create Purchase Order", exact: true });
    await poForm.getByLabel("PO Number", { exact: true }).fill("PO-SAVED");
    await poForm.getByRole("combobox").selectOption("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    await poForm.getByLabel("Currency", { exact: true }).fill("EUR");
    await poForm
      .getByLabel("Material ID", { exact: true })
      .fill("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    await poForm.getByLabel("Supplier Material Name", { exact: true }).fill("Material");
    await poForm.getByLabel("Ordered Quantity (mg)", { exact: true }).fill("1000");
    await poForm.getByLabel("Unit Price / kg", { exact: true }).fill("12");
    await page.evaluate(() => {
      (window as any).failReads = true;
    });
    await poForm.getByRole("button", { name: "Create Draft", exact: true }).click();
    await expect(poForm.getByLabel("PO Number", { exact: true })).toHaveValue("");
    await expect(poForm.getByRole("combobox")).toHaveValue("");
    await expect(poForm.getByLabel("Currency", { exact: true })).toHaveValue("USD");
    await expect.poll(() => page.evaluate(() => (window as any).dirty)).toBe(false);
    await expect(page.getByRole("status")).toContainText("The operation was saved");
    await expect(poForm.getByRole("button", { name: "Create Draft", exact: true })).toBeDisabled();
    const savedWrites = await page.evaluate(
      () => (window as any).calls.filter((c: any) => c.method).length
    );
    await page.getByRole("button", { name: "Retry loading saved records", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("The operation was saved");
    await page.evaluate(() => {
      (window as any).failReads = false;
    });
    await page.getByRole("button", { name: "Retry loading saved records", exact: true }).click();
    await expect(poForm.getByRole("button", { name: "Create Draft", exact: true })).toBeEnabled();
    expect(
      await page.evaluate(() => (window as any).calls.filter((c: any) => c.method).length)
    ).toBe(savedWrites);
    await page.getByRole("tab", { name: "Supplier Offers", exact: true }).click();
    await offerForm.getByRole("combobox").selectOption("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    await offerForm
      .getByLabel("Material ID", { exact: true })
      .fill("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    await offerForm.getByLabel("Supplier Material Name", { exact: true }).fill("Material");
    await offerForm.getByLabel("Supplier SKU", { exact: true }).fill("SKU");
    await offerForm.getByLabel("Unit Price / kg", { exact: true }).fill("25");
    await offerForm.getByLabel("Currency", { exact: true }).fill("EUR");
    await offerForm.getByRole("button", { name: "Create Offer", exact: true }).click();
    await expect(offerForm.getByLabel("Material ID", { exact: true })).toHaveValue("");
    await expect(offerForm.getByRole("combobox")).toHaveValue("");
    await expect(offerForm.getByLabel("Currency", { exact: true })).toHaveValue("USD");
    await expect(offerForm.getByLabel("Unit Price / kg", { exact: true })).toHaveValue("0");
    await expect.poll(() => page.evaluate(() => (window as any).dirty)).toBe(false);
    await page.evaluate(() => {
      (window as any).denyLocations = true;
      (window as any).switchTenant("tenant-read-only");
      (window as any).setPermissions(["module.procurement.read"]);
    });
    await expect(page.getByRole("table").first()).toContainText("PO-CHECK");
    const locationReads = await page.evaluate(
      () => (window as any).calls.filter((c: any) => c.path === "/inventory/locations").length
    );
    await page.getByRole("tab", { name: "Goods Receipts", exact: true }).click();
    await expect(page.getByRole("table")).toContainText("GR-CHECK");
    expect(
      await page.evaluate(
        () => (window as any).calls.filter((c: any) => c.path === "/inventory/locations").length
      )
    ).toBe(locationReads);
    await page.evaluate(() =>
      (window as any).setPermissions([
        "module.procurement.read",
        "module.procurement.receipt.create"
      ])
    );
    const locationRetry = page.getByRole("button", {
      name: "Retry Receipt locations",
      exact: true
    });
    await expect(locationRetry).toBeVisible();
    await expect(page.getByRole("button", { name: "Save Draft", exact: true })).toBeDisabled();
    await expect(page.locator("body")).not.toContainText("Private inventory denial");
    await page.evaluate(() => ((window as any).denyLocations = false));
    await locationRetry.click();
    await expect(page.getByRole("button", { name: "Save Draft", exact: true })).toBeEnabled();
    expect(errors).toEqual([]);
  });
