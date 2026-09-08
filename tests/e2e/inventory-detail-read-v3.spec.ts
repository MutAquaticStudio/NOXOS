import { build } from "esbuild";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

for (const width of [1440, 320])
  test(`Inventory detail authority and recovery at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const bundle = await build({
      stdin: {
        loader: "tsx",
        resolveDir: resolve("apps/nox-os/src"),
        contents: `
    import {createRoot} from 'react-dom/client';
    import {useState} from 'react';
    import {BrowserRouter,Routes,Route,useNavigate} from 'react-router-dom';
    import {NoxShell} from '@nox-os/ui';
    import '../../../packages/ui/src/styles.css';
    import {InventoryExperience} from './inventory';
    window.mode='ERROR';window.pending=[];window.writes=[];
    function payload(path,tenant){const id=path.split('/').at(-1);return {lot:{id,tenantId:tenant,lotCode:tenant+'-'+id,materialId:'material',materialDisplayName:'Fixture material',lifecycleStatus:'OPEN',availabilityStatus:'AVAILABLE',balances:[]},movements:[],reservations:[]};}
    async function api(path,options){if(options.method){window.writes.push({path,...options});return new Promise((resolve,reject)=>{window.acceptWrite=resolve;window.rejectWrite=()=>reject(Error('Private write diagnostic'));});}if(path==='/inventory/locations')return {locations:[{id:'location-a',locationCode:'LOC-A',status:'ACTIVE'},{id:'location-b',locationCode:'LOC-B',status:'ACTIVE'}]};
      if(window.mode==='ERROR')throw Error('Private SQL diagnostic');
      if(path==='/inventory/lots')return {lots:[]};
      const value=payload(path,options.tenantId);
      value.lot.availabilityStatus=window.lotHold?'HOLD':'AVAILABLE';
      value.reservations=[{id:'reservation-a',status:'ACTIVE',sourceModule:'MANUAL',quantityMg:'500',locationId:'location-a'}];
      if(window.mode==='HOLD')return new Promise(resolve=>window.pending.push(()=>resolve(value)));
      if(window.mode==='WRONG_TENANT')value.lot.tenantId='other';
      if(window.mode==='WRONG_ID')value.lot.id='other';
      if(window.mode==='BAD_BALANCE')value.lot.balances=[{availableMg:'bad'}];
      return value;
    }
    function App(){const [tenant,setTenant]=useState('tenant-a');const [grants,setGrants]=useState(['module.inventory.read','module.inventory.stock.receive']);window.setGrants=setGrants;const navigate=useNavigate();window.setTenant=setTenant;window.go=navigate;
      return <NoxShell theme="DARK" density="DEFAULT" activeRoute="/inventory" railItems={[]} onNavigate={()=>{}} onUnsavedChange={dirty=>window.dirty=dirty}>
      <Routes><Route path="/inventory/*" element={<InventoryExperience api={api} tenantId={tenant} modulePermissions={grants}/>}/></Routes></NoxShell>;
    }
    createRoot(document.getElementById('root')).render(<BrowserRouter><App/></BrowserRouter>);
  `
      },
      bundle: true,
      write: false,
      outfile: "inventory-read.js",
      platform: "browser",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' }
    });
    await page.route("**/*", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html lang="en"><title>Inventory read fixture</title><body><div id="root"></div></body></html>'
      })
    );
    await page.goto("/inventory/lots/lot-a");
    for (const f of bundle.outputFiles)
      if (f.path.endsWith(".css")) await page.addStyleTag({ content: f.text });
      else await page.addScriptTag({ content: f.text });
    await expect(page).toHaveTitle("Inventory read fixture");
    const retry = page.getByRole("button", { name: "Retry Material Lot", exact: true });
    await expect(retry).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Private SQL diagnostic");
    for (const mode of ["WRONG_TENANT", "WRONG_ID", "BAD_BALANCE"]) {
      await page.evaluate((mode) => ((window as any).mode = mode), mode);
      await retry.click();
      await expect(retry).toBeVisible();
      await expect(page.getByRole("heading", { name: /^Lot / })).toHaveCount(0);
    }
    await page.evaluate(() => ((window as any).mode = "READY"));
    await retry.click();
    await expect(
      page.getByRole("heading", { name: "Lot tenant-a-lot-a", exact: true })
    ).toBeVisible();
    await page.evaluate(() => {
      (window as any).mode = "HOLD";
      (window as any).go("/inventory/lots/lot-b");
    });
    await expect(
      page.getByRole("heading", { name: "Lot tenant-a-lot-a", exact: true })
    ).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as any).pending.length)).toBe(1);
    await page.evaluate(() => {
      (window as any).mode = "READY";
      (window as any).setTenant("tenant-b");
    });
    await expect(
      page.getByRole("heading", { name: "Lot tenant-b-lot-b", exact: true })
    ).toBeVisible();
    await page.evaluate(() =>
      (window as any).pending.splice(0).forEach((resolve: () => void) => resolve())
    );
    await expect(
      page.getByRole("heading", { name: "Lot tenant-b-lot-b", exact: true })
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText("tenant-a-lot-b");
    await expect(
      page.getByText("No location balances recorded for this lot.", { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText("No stock movements recorded for this lot.", { exact: true })
    ).toBeVisible();
    await page.getByLabel("Quantity (mg)", { exact: true }).fill("2000");
    await expect.poll(() => page.evaluate(() => (window as any).dirty)).toBe(true);
    await page.getByLabel("Quantity (mg)", { exact: true }).fill("1000");
    await page.getByRole("button", { name: "Record receive", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Confirm inventory movement" });
    await expect(dialog).toContainText("1000 mg");
    await expect(dialog).toContainText("tenant-b-lot-b");
    await dialog.getByRole("button", { name: "Cancel movement" }).click();
    await expect.poll(() => page.evaluate(() => (window as any).dirty)).toBe(true);
    expect(await page.evaluate(() => (window as any).writes.length)).toBe(0);
    await page.getByRole("button", { name: "Record receive", exact: true }).click();
    await dialog
      .getByRole("button", { name: "Confirm movement", exact: true })
      .evaluate((b: HTMLButtonElement) => {
        b.click();
        b.click();
      });
    await expect.poll(() => page.evaluate(() => (window as any).writes.length)).toBe(1);
    await page.evaluate(() => (window as any).rejectWrite());
    await expect(dialog.getByRole("button", { name: "Retry same movement" })).toBeVisible();
    await expect(page.getByLabel("Quantity (mg)", { exact: true })).toBeDisabled();
    await expect(page.locator("body")).not.toContainText("Private write diagnostic");
    await dialog.getByRole("button", { name: "Retry same movement" }).click();
    await expect.poll(() => page.evaluate(() => (window as any).writes.length)).toBe(2);
    const writes = await page.evaluate(() => (window as any).writes);
    expect(writes[1]).toEqual(writes[0]);
    await page.evaluate(() => (window as any).acceptWrite({}));
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Record receive", exact: true })).toBeEnabled();
    await expect.poll(() => page.evaluate(() => (window as any).dirty)).toBe(false);
    await page.evaluate(() =>
      (window as any).setGrants(["module.inventory.read", "module.inventory.stock.consume"])
    );
    await expect(page.getByRole("button", { name: "Record consume", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Record consume", exact: true }).click();
    const beforeDenied = await page.evaluate(() => (window as any).writes.length);
    await page.evaluate(() => (window as any).setGrants(["module.inventory.read"]));
    await dialog.getByRole("button", { name: "Confirm movement", exact: true }).click();
    expect(await page.evaluate(() => (window as any).writes.length)).toBe(beforeDenied);
    await dialog.getByRole("button", { name: "Cancel movement" }).click();
    await page.evaluate(() =>
      (window as any).setGrants(
        [
          "read",
          "stock.receive",
          "stock.transfer",
          "stock.consume",
          "stock.adjust",
          "stock.dispose",
          "reservation.manage"
        ].map((p) => "module.inventory." + p)
      )
    );
    for (const [operation, path, body] of [
      ["receive", "receive", { toLocationId: "location-a" }],
      ["transfer", "transfer", { fromLocationId: "location-a", toLocationId: "location-b" }],
      ["consume", "consume", { fromLocationId: "location-a" }],
      ["adjust-in", "adjust", { direction: "IN", locationId: "location-a" }],
      ["adjust-out", "adjust", { direction: "OUT", locationId: "location-a" }],
      ["dispose", "dispose", { fromLocationId: "location-a" }],
      ["reserve", "reservations", { locationId: "location-a", sourceReferenceId: null }]
    ] as const) {
      await page.getByRole("combobox").first().selectOption(operation);
      await page
        .getByRole("button", { name: "Record " + operation.replace("-", " "), exact: true })
        .click();
      if (operation === "reserve") await expect(dialog).toContainText("On Hand is unchanged");
      await dialog.getByRole("button", { name: "Confirm movement", exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => (window as any).writes.at(-1)?.path))
        .toBe("/inventory/lots/lot-b/" + path);
      expect(await page.evaluate(() => (window as any).writes.at(-1))).toMatchObject({
        tenantId: "tenant-b",
        method: "POST",
        body: { ...body, quantityMg: "1000", operationKey: expect.any(String) }
      });
      await page.evaluate(() => (window as any).acceptWrite({}));
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole("combobox").first()).toBeEnabled();
    }
    await page.evaluate(() =>
      (window as any).setGrants([
        "module.inventory.read",
        "module.inventory.lot.manage",
        "module.inventory.reservation.manage"
      ])
    );
    for (const [label, path] of [
      ["Place on hold", "/inventory/lots/lot-b/hold"],
      ["Close lot", "/inventory/lots/lot-b/close"],
      ["release", "/inventory/reservations/reservation-a/release"],
      ["cancel", "/inventory/reservations/reservation-a/cancel"],
      ["consume", "/inventory/reservations/reservation-a/consume"]
    ]) {
      const before = await page.evaluate(() => (window as any).writes.length);
      await page.getByRole("button", { name: label, exact: true }).click();
      await expect(dialog).toContainText("Lot tenant-b-lot-b");
      await dialog.getByRole("button", { name: "Cancel movement" }).click();
      expect(await page.evaluate(() => (window as any).writes.length)).toBe(before);
      await page.getByRole("button", { name: label, exact: true }).click();
      await dialog.getByRole("button", { name: "Confirm movement", exact: true }).click();
      await expect.poll(() => page.evaluate(() => (window as any).writes.at(-1)?.path)).toBe(path);
      await page.evaluate(() => (window as any).rejectWrite());
      await expect(dialog.getByRole("button", { name: "Retry same movement" })).toHaveCount(0);
      await dialog.getByRole("button", { name: "Read current lot without resubmitting" }).click();
      await expect(dialog).toHaveCount(0);
      expect(await page.evaluate(() => (window as any).writes.length)).toBe(before + 1);
    }
    await page.evaluate(() => {
      (window as any).lotHold = true;
      (window as any).go("/inventory/lots/lot-c");
    });
    await page.getByRole("button", { name: "Release hold", exact: true }).click();
    await expect(dialog).toContainText("Lot tenant-b-lot-c");
    await dialog.getByRole("button", { name: "Confirm movement", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => (window as any).writes.at(-1)?.path))
      .toBe("/inventory/lots/lot-c/release-hold");
    await page.evaluate(() => (window as any).acceptWrite({}));
    await expect(dialog).toHaveCount(0);
    await page.evaluate(() => {
      (window as any).go("/inventory");
      (window as any).setGrants([
        "module.inventory.read",
        "module.inventory.location.manage",
        "module.inventory.lot.create"
      ]);
    });
    const locationForm = page.getByRole("form", { name: "Create inventory location" });
    await locationForm.getByLabel("Code", { exact: true }).fill("NEW");
    await locationForm.getByLabel("Name", { exact: true }).fill("New location");
    await expect.poll(() => page.evaluate(() => (window as any).dirty)).toBe(true);
    const beforeCreate = await page.evaluate(() => (window as any).writes.length);
    await locationForm.evaluate((form: HTMLFormElement) => {
      form.requestSubmit();
      form.requestSubmit();
    });
    await expect
      .poll(() => page.evaluate(() => (window as any).writes.length))
      .toBe(beforeCreate + 1);
    await page.evaluate(() => (window as any).rejectWrite());
    await expect(locationForm.getByRole("button", { name: "Create Location" })).toBeDisabled();
    await expect(locationForm.getByLabel("Code", { exact: true })).toHaveValue("NEW");
    await page.getByRole("button", { name: "Refresh Inventory", exact: true }).click();
    await expect(locationForm.getByRole("button", { name: "Create Location" })).toBeDisabled();
    expect(await page.evaluate(() => (window as any).writes.length)).toBe(beforeCreate + 1);
    await page.evaluate(() => (window as any).setTenant("tenant-c"));
    await expect(locationForm.getByLabel("Code", { exact: true })).toHaveValue("");
    await page.getByRole("button", { name: "Archive", exact: true }).first().click();
    const archive = page.getByRole("dialog", { name: "Archive inventory location" });
    await expect(archive).toContainText("LOC-A");
    await archive.getByRole("button", { name: "Cancel archive" }).click();
    expect(await page.evaluate(() => (window as any).writes.length)).toBe(beforeCreate + 1);
    await page.getByRole("button", { name: "Archive", exact: true }).first().click();
    await archive.getByRole("button", { name: "Confirm archive" }).click();
    await expect
      .poll(() => page.evaluate(() => (window as any).writes.at(-1)?.path))
      .toBe("/inventory/locations/location-a/archive");
    await page.evaluate(() => (window as any).acceptWrite({}));
    await expect(archive).toHaveCount(0);
    const lotForm = page.getByRole("form", { name: "Create inventory lot" });
    await lotForm.getByLabel("Material UUID", { exact: true }).fill("material-a");
    await lotForm.getByLabel("Lot code", { exact: true }).fill("LOT-NEW");
    await lotForm.getByRole("button", { name: "Create Lot" }).click();
    await expect
      .poll(() => page.evaluate(() => (window as any).writes.at(-1)?.path))
      .toBe("/inventory/lots");
    await page.evaluate(() => (window as any).acceptWrite({ lot: { id: "new-lot" } }));
    await expect(page).toHaveURL(/\/inventory\/lots\/new-lot$/);
    await expect.poll(() => page.evaluate(() => (window as any).dirty)).toBe(false);
    expect(errors).toEqual([]);
    mkdirSync("/tmp/nox-ui-v3", { recursive: true });
    await page.screenshot({ path: "/tmp/nox-ui-v3/inventory-detail-" + width + ".png" });
  });
