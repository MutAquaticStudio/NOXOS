import { build } from "esbuild";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

for (const width of [1440, 320]) {
  test(`QC explicit decisions at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const bundle = await build({
      stdin: {
        loader: "tsx",
        resolveDir: resolve("apps/nox-os/src"),
        contents: `
      import {createRoot} from 'react-dom/client';import {BrowserRouter,Routes,Route,useNavigate} from 'react-router-dom';
      import {NoxShell} from '@nox-os/ui';import '../../../packages/ui/src/styles.css';import {QualityControlExperience} from './quality-control';
      window.writes=[];
      async function api(path,options){if(options.method){window.writes.push({path,...options});return new Promise((resolve,reject)=>{window.fail=()=>reject(Error('SQL private detail'));});}return {specifications:[],batch:{batch:{batchId:path.split('/').at(-1),batchNumber:'QC-BATCH',productionOrderStatus:'COMPLETED',formulaVersionId:'formula',formulaBundleHash:'hash',actualOutputMassMg:'1000000',allocations:[]},disposition:'NOT_ASSESSED',currentReadiness:{status:'UNAVAILABLE'},inspections:[],decisions:[]}};}
      function App(){window.go=useNavigate();return <NoxShell theme="DARK" density="DEFAULT" activeRoute="/quality-control" railItems={[]} onNavigate={()=>{}}><Routes><Route path="/quality-control/*" element={<QualityControlExperience api={api} tenantId="tenant-a" modulePermissions={['read','batch.hold','batch.release','batch.reject'].map(p=>'module.quality-control.'+p)}/>}/></Routes></NoxShell>;}
      createRoot(document.getElementById('root')).render(<BrowserRouter><App/></BrowserRouter>);
    `
      },
      bundle: true,
      write: false,
      outfile: "qc.js",
      platform: "browser",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' }
    });
    await page.route("**/*", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html><title>QC decision test</title><body><div id="root"></div></body></html>'
      })
    );
    await page.goto("/quality-control/batches/batch-first");
    for (const file of bundle.outputFiles)
      if (file.path.endsWith(".css")) await page.addStyleTag({ content: file.text });
      else await page.addScriptTag({ content: file.text });
    for (const action of ["Hold", "Release", "Reject"]) {
      await page.evaluate(
        (action) => (window as any).go("/quality-control/batches/batch-" + action),
        action
      );
      await page.getByRole("button", { name: action, exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Confirm QC decision" });
      await expect(dialog).toContainText("QC-BATCH");
      const before = await page.evaluate(() => (window as any).writes.length);
      await dialog.getByRole("button", { name: "Cancel decision" }).click();
      expect(await page.evaluate(() => (window as any).writes.length)).toBe(before);
      await page.getByRole("button", { name: action, exact: true }).click();
      if (action !== "Release")
        await page.getByLabel("Decision reason").fill("Controlled QC decision");
      await dialog
        .getByRole("button", { name: "Confirm decision" })
        .evaluate((button: HTMLButtonElement) => {
          button.click();
          button.click();
        });
      await expect.poll(() => page.evaluate(() => (window as any).writes.length)).toBe(before + 1);
      expect(await page.evaluate(() => (window as any).writes.at(-1))).toMatchObject({
        path: "/quality-control/batches/batch-" + action + "/" + action.toLowerCase(),
        method: "POST",
        tenantId: "tenant-a"
      });
      await page.evaluate(() => (window as any).fail());
      await expect(dialog).toContainText("Outcome unknown");
      await dialog.getByRole("button", { name: "Read current batch state" }).click();
      expect(await page.evaluate(() => (window as any).writes.length)).toBe(before + 1);
      await expect(dialog).toContainText("Last read disposition: NOT_ASSESSED");
      await expect(dialog.getByRole("button", { name: "Confirm decision" })).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText("SQL private detail");
    }
    expect(errors).toEqual([]);
  });
}
