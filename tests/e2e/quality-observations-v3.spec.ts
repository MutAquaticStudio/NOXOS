import { build } from "esbuild";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

for (const width of [1440, 320])
  test(`QC requires explicit observations at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const bundle = await build({
      stdin: {
        loader: "tsx",
        resolveDir: resolve("apps/nox-os/src"),
        contents: `
    import {createRoot} from 'react-dom/client';import {useState} from 'react';import {BrowserRouter,Routes,Route} from 'react-router-dom';
    import {NoxShell} from '@nox-os/ui';import '../../../packages/ui/src/styles.css';import {QualityControlExperience} from './quality-control';
    window.writes=[];window.saved=[];window.badRead='inspection';
    async function api(path,options){if(options.method){window.writes.push({path,...options});if(window.defer)return new Promise((resolve,reject)=>{window.fail=()=>reject(Error('Private SQL'));});window.saved=options.body.results;return {};}
      return {inspection:{id:'inspection-1',tenantId:window.badRead==='inspection'?'wrong-tenant':'tenant-a',batchId:'batch-1',specificationId:'spec-1',inspectionNumber:'INSPECTION-1',status:'DRAFT',results:window.saved},specification:{tenantId:'tenant-a',id:window.badRead==='spec'?'wrong-spec':'spec-1',specificationCode:'QC-SPEC',versionNumber:1,items:[{id:'boolean',name:'Seal intact',checkType:'BOOLEAN',expectedBoolean:true},{id:'text',name:'Appearance',checkType:'QUALITATIVE',acceptanceCriteriaText:'Clear'}]}};}
    function App(){const [edit,setEdit]=useState(true);window.setEdit=setEdit;return <NoxShell theme="DARK" density="DEFAULT" activeRoute="/quality-control" railItems={[]} onNavigate={()=>{}}><Routes><Route path="/quality-control/*" element={<QualityControlExperience api={api} tenantId="tenant-a" modulePermissions={['module.quality-control.read',...(edit?['module.quality-control.inspection.edit']:[])]}/>}/></Routes></NoxShell>;}
    createRoot(document.getElementById('root')).render(<BrowserRouter><App/></BrowserRouter>);
  `
      },
      bundle: true,
      write: false,
      outfile: "qc-observations.js",
      platform: "browser",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' }
    });
    await page.route("**/*", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html><title>QC observations</title><body><div id="root"></div></body></html>'
      })
    );
    await page.goto("/quality-control/inspections/inspection-1");
    for (const f of bundle.outputFiles)
      if (f.path.endsWith(".css")) await page.addStyleTag({ content: f.text });
      else await page.addScriptTag({ content: f.text });
    await expect(page.getByRole("button", { name: /retry/i })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("INSPECTION-1");
    await page.evaluate(() => ((window as any).badRead = "spec"));
    await page.getByRole("button", { name: /retry/i }).click();
    await expect(page.getByRole("button", { name: /retry/i })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("INSPECTION-1");
    await page.evaluate(() => ((window as any).badRead = undefined));
    await page.getByRole("button", { name: /retry/i }).click();
    const boolean = page.getByLabel("Seal intact observation");
    const judgement = page.getByLabel("Appearance judgement");
    await expect(boolean).toHaveValue("");
    await expect(judgement).toHaveValue("");
    await page.getByRole("button", { name: "Save observations" }).click();
    expect(await page.evaluate(() => (window as any).writes.length)).toBe(0);
    await boolean.selectOption("false");
    await page.getByLabel("Appearance observation").fill("Cloudy");
    await judgement.selectOption("FAIL");
    await page.getByRole("button", { name: "Save observations" }).click();
    await expect.poll(() => page.evaluate(() => (window as any).writes.length)).toBe(1);
    expect(await page.evaluate(() => (window as any).writes[0].body.results)).toEqual([
      { checkType: "BOOLEAN", specificationItemId: "boolean", observedBooleanValue: false },
      {
        checkType: "QUALITATIVE",
        specificationItemId: "text",
        observedText: "Cloudy",
        judgement: "FAIL"
      }
    ]);
    await page.evaluate(() => (window as any).setEdit(false));
    await expect(boolean).toBeDisabled();
    await expect(judgement).toBeDisabled();
    await expect(page.getByLabel("Appearance observation")).toBeDisabled();
    await page.evaluate(() => {
      (window as any).setEdit(true);
      (window as any).defer = true;
    });
    await page.getByLabel("Appearance observation").fill("Retain this evidence");
    await expect(page.locator("body")).toContainText("Unsaved observations");
    await page.locator("form").evaluate((form: HTMLFormElement) => {
      form.requestSubmit();
      form.requestSubmit();
    });
    await expect.poll(() => page.evaluate(() => (window as any).writes.length)).toBe(2);
    await page.evaluate(() => (window as any).fail());
    await expect(page.locator("body")).toContainText("Save outcome unknown");
    await expect(page.getByLabel("Appearance observation")).toHaveValue("Retain this evidence");
    await expect(page.getByRole("button", { name: "Save observations" })).toBeDisabled();
    await expect(page.locator("body")).not.toContainText("Private SQL");
    expect(errors).toEqual([]);
  });
