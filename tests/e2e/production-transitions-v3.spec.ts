import { build } from "esbuild";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
for (const width of [1440, 320])
  test(`Production transitions at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const bundle = await build({
      stdin: {
        loader: "tsx",
        resolveDir: resolve("apps/nox-os/src"),
        contents: `
 import {createRoot} from 'react-dom/client';import {useState} from 'react';import {BrowserRouter,Routes,Route,useNavigate} from 'react-router-dom';
 import {NoxShell} from '@nox-os/ui';import '../../../packages/ui/src/styles.css';import {ProductionExperience} from './production';
 window.writes=[];window.orderStatus='DRAFT';
 async function api(path,options){if(options.method){window.writes.push({path,...options});return new Promise((resolve,reject)=>{window.accept=resolve;window.reject=()=>reject(Error('Private transaction internals'));});}const id=path.split('/').at(-1);const tenantId=window.badRead==='tenant'?'other-tenant':options.tenantId;const allocations=window.badRead==='shape'?null:[];return {order:{id,tenantId,orderNumber:'ORDER-CHECK',status:window.orderStatus,formulaVersionId:'formula-id',formulaBundleHash:'hash',targetMassMg:'1000001',lines:[],allocations},batch:{id,tenantId,batchNumber:'BATCH-CHECK',formulaVersionId:'formula-id',targetMassMg:'1000001',actualOutputMassMg:null,completedAt:null,abortedAt:null,allocations}};}
 function App(){const [grants,setGrants]=useState(['read','order.release','order.cancel','batch.start','batch.complete','batch.abort'].map(p=>'module.production.'+p));window.setGrants=setGrants;window.go=useNavigate();return <NoxShell theme="DARK" density="DEFAULT" activeRoute="/production" railItems={[]} onNavigate={()=>{}}><Routes>{['/production/orders/:orderId','/production/batches/:batchId'].map(path=><Route key={path} path={path} element={<ProductionExperience api={api} tenantId="tenant-a" modulePermissions={grants}/>}/>)}</Routes></NoxShell>;}
 createRoot(document.getElementById('root')).render(<BrowserRouter><App/></BrowserRouter>);
 `
      },
      bundle: true,
      write: false,
      outfile: "production-transitions.js",
      platform: "browser",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' }
    });
    await page.route("**/*", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html lang="en"><title>Production transitions</title><body><div id="root"></div></body></html>'
      })
    );
    await page.goto("/production/orders/order-0");
    for (const f of bundle.outputFiles)
      if (f.path.endsWith(".css")) await page.addStyleTag({ content: f.text });
      else await page.addScriptTag({ content: f.text });
    const dialog = page.getByRole("dialog", { name: "Confirm Production action" });
    for (const [i, label, kind, action, status, consequence] of [
      [1, "Release", "orders", "release", "DRAFT", "On Hand stays unchanged"],
      [2, "Cancel", "orders", "cancel", "DRAFT", "no stock consumption"],
      [3, "Start batch", "orders", "start", "RELEASED", "consumes exact reserved stock"],
      [4, "Complete batch", "batches", "complete", "IN_PROGRESS", "does not release QC"],
      [5, "Abort batch", "batches", "abort", "IN_PROGRESS", "not automatically returned"]
    ] as const) {
      await page.evaluate(
        ({ kind, i, status }) => {
          (window as any).orderStatus = status;
          (window as any).go("/production/" + kind + "/target-" + i);
        },
        { kind, i, status }
      );
      if (kind === "batches") {
        await expect(page.getByLabel("Actual output (mg)", { exact: true })).toHaveValue("");
        await page.getByLabel("Actual output (mg)", { exact: true }).fill("950000");
        await page.getByLabel("Process notes", { exact: true }).fill("Retain this batch draft");
        await page.getByLabel("Abort reason", { exact: true }).fill("Controlled test");
      }
      const before = await page.evaluate(() => (window as any).writes.length);
      await expect(page.locator("body")).toContainText("1 kg 1 mg");
      await page.getByRole("button", { name: label, exact: true }).click();
      await expect(dialog).toContainText(consequence);
      await dialog.getByRole("button", { name: "Cancel action" }).click();
      expect(await page.evaluate(() => (window as any).writes.length)).toBe(before);
      await page.getByRole("button", { name: label, exact: true }).click();
      await dialog
        .getByRole("button", { name: "Confirm action" })
        .evaluate((b: HTMLButtonElement) => {
          b.click();
          b.click();
        });
      await expect.poll(() => page.evaluate(() => (window as any).writes.length)).toBe(before + 1);
      expect(await page.evaluate(() => (window as any).writes.at(-1))).toMatchObject({
        path: "/production/" + kind + "/target-" + i + "/" + action,
        tenantId: "tenant-a",
        method: "POST"
      });
      await page.evaluate(() => (window as any).reject());
      await expect(dialog).toContainText("Outcome unknown");
      await expect(page.locator("body")).not.toContainText("Private transaction internals");
      await dialog.getByRole("button", { name: "Read current Production state" }).click();
      await expect(dialog).toHaveCount(0);
      if (kind === "batches") {
        await expect(page.getByLabel("Actual output (mg)", { exact: true })).toHaveValue("950000");
        await expect(page.getByLabel("Process notes", { exact: true })).toHaveValue(
          "Retain this batch draft"
        );
        await expect(page.getByLabel("Abort reason", { exact: true })).toHaveValue(
          "Controlled test"
        );
      }
      expect(await page.evaluate(() => (window as any).writes.length)).toBe(before + 1);
    }
    await page.evaluate(() => {
      (window as any).orderStatus = "DRAFT";
      (window as any).go("/production/orders/revoked");
    });
    await page.getByRole("button", { name: "Release", exact: true }).click();
    const before = await page.evaluate(() => (window as any).writes.length);
    await page.evaluate(() => (window as any).setGrants(["module.production.read"]));
    await dialog.getByRole("button", { name: "Confirm action" }).click();
    await expect(dialog).toContainText("Action rejected");
    expect(await page.evaluate(() => (window as any).writes.length)).toBe(before);
    for (const kind of ["orders", "batches"]) {
      for (const badRead of ["tenant", "shape"]) {
        await page.evaluate(
          ({ kind, badRead }) => {
            (window as any).badRead = badRead;
            (window as any).go(`/production/${kind}/invalid-${badRead}`);
          },
          { kind, badRead }
        );
        await expect(page.getByRole("button", { name: /retry/i })).toBeVisible();
        await expect(page.locator("body")).not.toContainText("ORDER-CHECK");
        await expect(page.locator("body")).not.toContainText("BATCH-CHECK");
      }
    }
    expect(errors).toEqual([]);
  });
