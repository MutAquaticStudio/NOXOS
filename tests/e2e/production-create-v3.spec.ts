import { build } from "esbuild";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

for (const width of [1440, 320])
  test(`Production create containment at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const bundle = await build({
      stdin: {
        loader: "tsx",
        resolveDir: resolve("apps/nox-os/src"),
        contents: `
    import {createRoot} from 'react-dom/client';import {useState} from 'react';
    import {BrowserRouter,Routes,Route} from 'react-router-dom';
    import {NoxShell} from '@nox-os/ui';import '../../../packages/ui/src/styles.css';
    import {ProductionExperience} from './production';
    window.writes=[];window.pending=[];
    async function api(path,options){if(!options.method)return {orders:[]};window.writes.push({path,...options});return new Promise((resolve,reject)=>window.pending.push({resolve,reject}));}
    function App(){const [tenant,setTenant]=useState('tenant-a');window.setTenant=setTenant;return <NoxShell activeRoute="/production" theme="DARK" density="DEFAULT" railItems={[]} onNavigate={()=>{}} onUnsavedChange={dirty=>window.dirty=dirty}>
    <Routes><Route path="/production/*" element={<ProductionExperience api={api} tenantId={tenant} modulePermissions={['module.production.read','module.production.order.create']}/>}/></Routes></NoxShell>;}
    createRoot(document.getElementById('root')).render(<BrowserRouter><App/></BrowserRouter>);
  `
      },
      bundle: true,
      write: false,
      outfile: "production-create.js",
      platform: "browser",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' }
    });
    await page.route("**/*", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html lang="en"><title>Production create fixture</title><body><div id="root"></div></body></html>'
      })
    );
    await page.goto("/production/new");
    for (const f of bundle.outputFiles)
      if (f.path.endsWith(".css")) await page.addStyleTag({ content: f.text });
      else await page.addScriptTag({ content: f.text });
    await expect(page).toHaveTitle("Production create fixture");
    const form = page.getByRole("form", { name: "Create production order" });
    const fill = async () => {
      await form.getByLabel("Order number", { exact: true }).fill("PO-DRAFT");
      await form.getByLabel("Frozen FormulaVersion ID", { exact: true }).fill("formula-id");
      await form.getByLabel("Target mass (mg)", { exact: true }).fill("1000000");
    };
    await fill();
    await expect.poll(() => page.evaluate(() => (window as any).dirty)).toBe(true);
    await form.evaluate((f: HTMLFormElement) => {
      f.requestSubmit();
      f.requestSubmit();
    });
    await expect.poll(() => page.evaluate(() => (window as any).writes.length)).toBe(1);
    await page.evaluate(() =>
      (window as any).pending.shift().reject(Error("Private SQL password"))
    );
    await expect(page.getByRole("status")).toContainText("Outcome unknown");
    await expect(form.getByLabel("Order number", { exact: true })).toHaveValue("PO-DRAFT");
    await expect(form.getByRole("button", { name: "Create draft order" })).toBeDisabled();
    await expect(page.locator("body")).not.toContainText("Private SQL password");
    await page.evaluate(() => (window as any).setTenant("tenant-b"));
    await expect(form.getByLabel("Order number", { exact: true })).toHaveValue("");
    await fill();
    await form.getByRole("button", { name: "Create draft order" }).click();
    await expect.poll(() => page.evaluate(() => (window as any).pending.length)).toBe(1);
    await page.evaluate(() => (window as any).setTenant("tenant-c"));
    await expect(form.getByLabel("Order number", { exact: true })).toHaveValue("");
    await page.evaluate(() =>
      (window as any).pending.shift().resolve({ order: { id: "old-tenant-order" } })
    );
    await expect(page).toHaveURL(/\/production\/new$/);
    await fill();
    await form.getByRole("button", { name: "Create draft order" }).click();
    await expect.poll(() => page.evaluate(() => (window as any).pending.length)).toBe(1);
    await page.evaluate(() =>
      (window as any).pending.shift().resolve({ order: { id: "current-order" } })
    );
    await expect(page).toHaveURL(/\/production\/orders\/current-order$/);
    await expect.poll(() => page.evaluate(() => (window as any).dirty)).toBe(false);
    expect(errors).toEqual([]);
  });
