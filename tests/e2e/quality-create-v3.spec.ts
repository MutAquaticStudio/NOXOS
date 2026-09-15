import { build } from "esbuild";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
for (const width of [1440, 320])
  test(`QC create draft containment at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const bundle = await build({
      stdin: {
        loader: "tsx",
        resolveDir: resolve("apps/nox-os/src"),
        contents: `
 import {createRoot} from 'react-dom/client';import {BrowserRouter,Routes,Route} from 'react-router-dom';import {NoxShell} from '@nox-os/ui';import '../../../packages/ui/src/styles.css';import {QualityControlExperience} from './quality-control';
 window.writes=[];window.invalidRead=true;async function api(path,options){if(options.method){window.writes.push({path,...options});return new Promise((resolve,reject)=>{window.fail=()=>reject(Error('Private SQL'));});}return {specifications:window.invalidRead?[{tenantId:'wrong-tenant',items:[],specificationCode:'PRIVATE-SPEC'}]:[]};}
 createRoot(document.getElementById('root')).render(<BrowserRouter><NoxShell theme="DARK" density="DEFAULT" activeRoute="/quality-control" railItems={[]} onNavigate={()=>{}}><Routes><Route path="/quality-control/*" element={<QualityControlExperience api={api} tenantId="tenant-a" modulePermissions={['module.quality-control.read','module.quality-control.specification.manage']}/>}/></Routes></NoxShell></BrowserRouter>);
 `
      },
      bundle: true,
      write: false,
      outfile: "qc-create.js",
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
    await page.goto("/quality-control/specifications");
    for (const f of bundle.outputFiles)
      if (f.path.endsWith(".css")) await page.addStyleTag({ content: f.text });
      else await page.addScriptTag({ content: f.text });
    const form = page.getByRole("form", { name: "Create specification" });
    await expect(page.getByRole("button", { name: /retry/i })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("PRIVATE-SPEC");
    await expect(page.locator("body")).not.toContainText("No specifications recorded.");
    await expect(form.getByRole("button", { name: "Create DRAFT" })).toBeDisabled();
    await page.evaluate(() => ((window as any).invalidRead = false));
    await page.getByRole("button", { name: /retry/i }).click();
    await expect(page.locator("body")).toContainText("No specifications recorded.");
    mkdirSync("/tmp/nox-ui-v3", { recursive: true });
    await form.screenshot({ path: `/tmp/nox-ui-v3/qc-create-${width}.png` });
    const accessibility = await new AxeBuilder({ page })
      .include('form[aria-label="Create specification"]')
      .analyze();
    expect(
      accessibility.violations.filter((v) => v.impact === "critical" || v.impact === "serious")
    ).toEqual([]);
    await form.getByLabel("Notes").fill("Discard candidate");
    await form.getByRole("button", { name: "Discard draft" }).click();
    const discard = page.getByRole("dialog", { name: "Discard specification draft" });
    await page.screenshot({ path: `/tmp/nox-ui-v3/qc-discard-${width}.png` });
    await discard.getByRole("button", { name: "Keep editing" }).click();
    await expect(form.getByLabel("Notes")).toHaveValue("Discard candidate");
    await form.getByRole("button", { name: "Discard draft" }).click();
    await discard.getByRole("button", { name: "Discard unsaved fields" }).click();
    await expect(form.getByLabel("Notes")).toHaveValue("");
    expect(await page.evaluate(() => (window as any).writes.length)).toBe(0);
    await form.getByLabel("Code", { exact: true }).fill("QC-NEW");
    await form.getByLabel("Version", { exact: true }).fill("1");
    await form.getByLabel("FormulaVersion ID").fill("formula-id");
    await form.getByLabel("Bundle Hash").fill("a".repeat(64));
    await form.getByLabel("Notes").fill("Retain this draft");
    await form.evaluate((f: HTMLFormElement) => {
      f.requestSubmit();
      f.requestSubmit();
    });
    await expect.poll(() => page.evaluate(() => (window as any).writes.length)).toBe(1);
    await page.evaluate(() => (window as any).fail());
    await expect(form).toContainText("Creation outcome unknown");
    await expect(form.getByLabel("Notes")).toHaveValue("Retain this draft");
    await expect(form.getByRole("button", { name: "Create DRAFT" })).toBeDisabled();
    await expect(page.locator("body")).not.toContainText("Private SQL");
    await expect(form.getByRole("button", { name: "Discard draft" })).toBeDisabled();
    expect(errors).toEqual([]);
  });
