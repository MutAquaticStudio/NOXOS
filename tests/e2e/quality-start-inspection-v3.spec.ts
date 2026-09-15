import { build } from "esbuild";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
for (const width of [1440, 320])
  test(`QC start inspection containment at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const bundle = await build({
      stdin: {
        loader: "tsx",
        resolveDir: resolve("apps/nox-os/src"),
        contents: `
 import {createRoot} from 'react-dom/client';import {BrowserRouter,Routes,Route} from 'react-router-dom';import {NoxShell} from '@nox-os/ui';import '../../../packages/ui/src/styles.css';import {QualityControlExperience} from './quality-control';
 window.writes=[];async function api(path,options){if(options.method){window.writes.push({path,...options});return new Promise((resolve,reject)=>{window.fail=()=>reject(Error('Private SQL'));});}return {specifications:[{id:'spec',status:'ACTIVE',specificationCode:'SPEC',versionNumber:1,formulaVersionId:'formula',formulaBundleHash:'hash'}],batch:{batch:{batchId:'batch',batchNumber:'BATCH',productionOrderStatus:'COMPLETED',formulaVersionId:'formula',formulaBundleHash:'hash',actualOutputMassMg:'1000000',allocations:[]},currentReadiness:{status:'MISSING'},disposition:'NOT_ASSESSED'}};}
 createRoot(document.getElementById('root')).render(<BrowserRouter><NoxShell theme="DARK" density="DEFAULT" activeRoute="/quality-control" railItems={[]} onNavigate={()=>{}}><Routes><Route path="/quality-control/*" element={<QualityControlExperience api={api} tenantId="tenant-a" modulePermissions={['module.quality-control.read','module.quality-control.inspection.create']}/>}/></Routes></NoxShell></BrowserRouter>);
 `
      },
      bundle: true,
      write: false,
      outfile: "qc-start.js",
      platform: "browser",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' }
    });
    await page.route("**/*", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html><title>QC create</title><body><div id="root"></div></body></html>'
      })
    );
    await page.goto("/quality-control/batches/batch");
    for (const f of bundle.outputFiles)
      if (f.path.endsWith(".css")) await page.addStyleTag({ content: f.text });
      else await page.addScriptTag({ content: f.text });
    const form = page.getByRole("form", { name: "Start inspection" });
    await form.getByLabel("Sample reference").fill("Discard candidate");
    await form.getByRole("button", { name: "Discard draft" }).click();
    const discard = page.getByRole("dialog", { name: "Discard inspection draft" });
    await discard.getByRole("button", { name: "Keep editing" }).click();
    await expect(form.getByLabel("Sample reference")).toHaveValue("Discard candidate");
    await form.getByRole("button", { name: "Discard draft" }).click();
    await discard.getByRole("button", { name: "Discard unsaved fields" }).click();
    await expect(form.getByLabel("Sample reference")).toHaveValue("");
    expect(await page.evaluate(() => (window as any).writes.length)).toBe(0);
    await form.getByLabel("Active specification").selectOption("spec");
    await form.getByLabel("Sample reference").fill("Retain this draft");
    await form.evaluate((f: HTMLFormElement) => {
      f.requestSubmit();
      f.requestSubmit();
    });
    await expect.poll(() => page.evaluate(() => (window as any).writes.length)).toBe(1);
    await page.evaluate(() => (window as any).fail());
    await expect(form).toContainText("Inspection creation outcome unknown");
    await expect(form.getByLabel("Sample reference")).toHaveValue("Retain this draft");
    await expect(form.getByRole("button", { name: "Create inspection" })).toBeDisabled();
    await expect(page.locator("body")).not.toContainText("Private SQL");
    await expect(form.getByRole("button", { name: "Discard draft" })).toBeDisabled();
    expect(errors).toEqual([]);
  });
