import { build } from "esbuild";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
for (const width of [1440, 320])
  test(`Specification confirmations at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const bundle = await build({
      stdin: {
        loader: "tsx",
        resolveDir: resolve("apps/nox-os/src"),
        contents: `
    import {createRoot} from 'react-dom/client';import {BrowserRouter,Routes,Route,useNavigate} from 'react-router-dom';import {NoxShell} from '@nox-os/ui';import '../../../packages/ui/src/styles.css';import {QualityControlExperience} from './quality-control';
    window.writes=[];window.statusValue='DRAFT';
    async function api(path,options){if(options.method){window.writes.push({path,...options});return new Promise((resolve,reject)=>{window.fail=()=>reject(Error('Secret internal'));});}return {inspection:{id:path.split('/').at(-1),tenantId:'tenant-a',batchId:'batch',specificationId:'spec',inspectionNumber:'SPEC',status:window.statusValue,results:[]},specification:{tenantId:'tenant-a',id:path.split('/').at(-1),specificationCode:'SPEC',versionNumber:1,status:window.statusValue,items:[]}};}
    function App(){window.go=useNavigate();return <NoxShell theme="DARK" density="DEFAULT" activeRoute="/quality-control" railItems={[]} onNavigate={()=>{}}><Routes><Route path="/quality-control/*" element={<QualityControlExperience api={api} tenantId="tenant-a" modulePermissions={['read','specification.manage'].map(p=>'module.quality-control.'+p)}/>}/></Routes></NoxShell>;}
    createRoot(document.getElementById('root')).render(<BrowserRouter><App/></BrowserRouter>);
  `
      },
      bundle: true,
      write: false,
      outfile: "specification-actions.js",
      platform: "browser",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' }
    });
    await page.route("**/*", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html><title>Inspection actions</title><body><div id="root"></div></body></html>'
      })
    );
    await page.goto("/quality-control/specifications/initial");
    for (const f of bundle.outputFiles)
      if (f.path.endsWith(".css")) await page.addStyleTag({ content: f.text });
      else await page.addScriptTag({ content: f.text });
    for (const action of ["Load baseline items", "Activate", "Retire"]) {
      await page.evaluate((action) => {
        (window as any).statusValue = action === "Retire" ? "ACTIVE" : "DRAFT";
        (window as any).go("/quality-control/specifications/" + action);
      }, action);
      await page.getByRole("button", { name: action, exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Confirm specification action" });
      await expect(dialog).toContainText("SPEC");
      const count = await page.evaluate(() => (window as any).writes.length);
      await dialog.getByRole("button", { name: "Cancel action" }).click();
      expect(await page.evaluate(() => (window as any).writes.length)).toBe(count);
      await page.getByRole("button", { name: action, exact: true }).click();
      await dialog
        .getByRole("button", { name: "Confirm action" })
        .evaluate((button: HTMLButtonElement) => {
          button.click();
          button.click();
        });
      await expect.poll(() => page.evaluate(() => (window as any).writes.length)).toBe(count + 1);
      expect(await page.evaluate(() => (window as any).writes.at(-1))).toMatchObject({
        path:
          "/quality-control/specifications/" +
          action +
          "/" +
          (action === "Load baseline items" ? "items" : action.toLowerCase()),
        tenantId: "tenant-a",
        method: action === "Load baseline items" ? "PUT" : "POST"
      });
      await page.evaluate(() => (window as any).fail());
      await expect(dialog).toContainText("Outcome unknown");
      await expect(dialog.getByRole("button", { name: "Confirm action" })).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText("Secret internal");
    }
    expect(errors).toEqual([]);
  });
