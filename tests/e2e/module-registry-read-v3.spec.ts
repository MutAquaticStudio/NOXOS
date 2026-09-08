import { build } from "esbuild";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const cases = [
  ["release-readiness", "Release Assessments", "No release assessments."],
  ["production", "Production", "No production orders found."],
  ["quality-control", "Quality Control", "No completed Production Batches found."],
  ["project-operations", "Project Operations", "No Operational Projects match these filters."],
  ["inventory", "Inventory", "No physical stock has been registered."],
  ["lab-services", "Lab Services", "No Customers found."],
  ["procurement", "Procurement", "No Purchase Orders recorded."]
] as const;

for (const width of [1280, 1024, 768, 320])
  for (const [moduleId, subject, empty] of cases)
    test(`${moduleId} verified registry reads at ${width}`, async ({ page }) => {
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
            import {BrowserRouter,Routes,Route} from 'react-router-dom';
            import {NoxShell} from '@nox-os/ui';
            import '../../../packages/ui/src/styles.css';
            import {ReleaseReadinessExperience} from './release-readiness';
            import {ProductionExperience} from './production';
            import {QualityControlExperience} from './quality-control';
            import {ProjectOperationsExperience} from './project-operations';
            import {InventoryExperience} from './inventory';
            import {LabServicesExperience} from './lab-services';
            import {ProcurementExperience} from './procurement';
            const moduleId=${JSON.stringify(moduleId)};
            const Component={'release-readiness':ReleaseReadinessExperience,production:ProductionExperience,'quality-control':QualityControlExperience,'project-operations':ProjectOperationsExperience,inventory:InventoryExperience,'lab-services':LabServicesExperience,procurement:ProcurementExperience}[moduleId];
            const grants=['module.release-readiness.assessment.read','module.production.read','module.quality-control.read','module.project-operations.read','module.inventory.read','module.lab-services.read','module.procurement.read'];
            window.mode='HOLD'; window.reads=[]; window.pending=[];
            const empty={assessments:[],orders:[],batches:[],projects:[],lots:[],locations:[],customers:[],serviceOrders:[],suppliers:[],offers:[],purchaseOrders:[],goodsReceipts:[]};
            function payload(tenantId){
              const id=tenantId==='tenant-a'?'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa':'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
              return {
                ...empty,
                lots:[{id,tenantId,materialId:id,materialDisplayName:tenantId,lotCode:tenantId,lifecycleStatus:'OPEN',availabilityStatus:'AVAILABLE',balances:[{locationId:id,onHandMg:'120000',availableMg:'120000',reservedMg:'0'}]}],
                customers:[{id,displayName:tenantId,customerType:'COMPANY',status:'ACTIVE',openServiceOrderCount:0}],
                purchaseOrders:[{id,poNumber:tenantId,supplierDisplayName:tenantId,status:'DRAFT',currencyCode:'USD',updatedAt:'2026-09-05T00:00:00Z',lines:[]}],
                assessments:[{id,formulaVersionId:id,releaseProfile:{applicationKey:'fine-fragrance',dosagePct:20},policyKey:tenantId,policyVersion:'1',decision:'REVIEW_REQUIRED',assessedAt:'2026-09-05T00:00:00Z'}],
                orders:[{id,tenantId,orderNumber:tenantId,formulaVersionId:id,targetMassMg:'120000',status:'DRAFT',allocations:[],lines:[]}],
                batches:[{batch:{batchId:id,batchNumber:tenantId,formulaVersionId:id,productionOrderStatus:'COMPLETED',actualOutputMassMg:'120000'},currentReadiness:{status:'UNAVAILABLE'},disposition:'NOT_ASSESSED'}],
                projects:[{id,project_code:tenantId,name:tenantId,project_type:'INTERNAL',status:'DRAFT',required_task_count:0,completed_required_task_count:0,required_phase_count:0}]
              };
            }
            async function api(path,options={}){
              window.reads.push({path,tenantId:options.tenantId,method:options.method??'GET'});
              if(!options.tenantId)throw Error('Missing tenant');
              if(options.method&&options.method!=='GET')throw Error('Unexpected mutation');
              if(window.mode==='HOLD')return new Promise((resolve,reject)=>window.pending.push({resolve,reject,tenantId:options.tenantId}));
              if(window.mode==='MALFORMED')return {};
              if(window.mode==='EMPTY')return empty;
              if(window.mode==='BROKEN_ROW')return {...payload(options.tenantId),assessments:[{id:'../platform/users',decision:'READY'}]};
              return payload(options.tenantId);
            }
            window.releaseOld=()=>{for(const pending of window.pending.splice(0))pending.resolve(payload(pending.tenantId));};
            function App(){
              const [tenantId,setTenantId]=useState('tenant-a');
              return <NoxShell theme="DARK" density="DEFAULT" activeRoute={'/'+moduleId} railItems={[]} onNavigate={()=>{}} tenantControl={<label>Fixture tenant<select value={tenantId} onChange={e=>setTenantId(e.target.value)}><option>tenant-a</option><option>tenant-b</option></select></label>}>
                <Routes><Route path={'/'+moduleId+'/*'} element={<Component api={api} tenantId={tenantId} modulePermissions={grants}/>}/></Routes>
              </NoxShell>;
            }
            createRoot(document.getElementById('root')).render(<BrowserRouter><App/></BrowserRouter>);
          `
        },
        bundle: true,
        write: false,
        outfile: "fixture.js",
        jsx: "automatic",
        platform: "browser",
        define: { "process.env.NODE_ENV": '"production"' }
      });
      await page.route("**/*", (route) =>
        route.fulfill({
          contentType: "text/html",
          body: '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>NØX registry read fixture</title></head><body><div id="root"></div></body></html>'
        })
      );
      await page.goto(`/${moduleId}`);
      for (const output of bundle.outputFiles)
        if (output.path.endsWith(".css")) await page.addStyleTag({ content: output.text });
        else await page.addScriptTag({ content: output.text });

      await expect(page).toHaveTitle("NØX registry read fixture");
      const loading = page.getByRole("status").filter({ hasText: `Loading ${subject} data` });
      await expect(loading).toBeVisible();
      await expect(page.getByText(empty, { exact: true })).toHaveCount(0);
      await page.evaluate(() => {
        for (const pending of (window as any).pending.splice(0))
          pending.reject(Error("Private provider diagnostics must not render"));
      });
      const retry = page.getByRole("button", { name: `Retry ${subject}`, exact: true });
      await expect(retry).toBeVisible();
      await expect(page.getByText(empty, { exact: true })).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText("Private provider diagnostics");
      await page.evaluate(() => {
        (window as any).mode = "MALFORMED";
      });
      await retry.click();
      await expect(retry).toBeVisible();
      await expect(page.getByText(empty, { exact: true })).toHaveCount(0);
      await page.evaluate(() => {
        (window as any).mode = "EMPTY";
      });
      await retry.click();
      await expect(page.getByText(empty, { exact: true })).toBeVisible();
      const refresh = page.getByRole("button", { name: `Refresh ${subject}`, exact: true });
      await page.evaluate(() => {
        (window as any).mode = "DATA";
      });
      if (moduleId === "procurement")
        await page.getByLabel("Fixture tenant").selectOption("tenant-b");
      else await refresh.click();
      await expect(page.getByRole("table").first()).toContainText(
        moduleId === "procurement" ? "tenant-b" : "tenant-a"
      );
      if (moduleId === "release-readiness") {
        const callCount = await page.evaluate(() => (window as any).reads.length);
        await page.getByLabel("Recorded decision", { exact: true }).selectOption("READY");
        await expect(page).toHaveURL(/decision=READY/);
        await expect(
          page.getByText("No assessments match these filters.", { exact: false })
        ).toBeVisible();
        await expect(page.getByText("No release assessments.", { exact: true })).toHaveCount(0);
        await page.goBack();
        await expect(page.getByRole("table")).toContainText("REVIEW REQUIRED");
        await page.goForward();
        await expect(page.getByRole("table").getByRole("link")).toHaveCount(0);
        await page.getByRole("button", { name: "Clear filters" }).click();
        await page.getByLabel("FormulaVersion ID", { exact: true }).fill("aaaaaaaa");
        await page.getByLabel("Application", { exact: true }).selectOption("fine-fragrance");
        await expect(page.getByRole("table").getByRole("link")).toHaveAttribute(
          "href",
          "/release-readiness/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        );
        expect(await page.evaluate(() => (window as any).reads.length)).toBe(callCount);
        await page.getByRole("button", { name: "Clear filters" }).click();
        await page.evaluate(() => {
          (window as any).mode = "BROKEN_ROW";
        });
        await refresh.click();
        await expect(retry).toBeVisible();
        await expect(page.getByRole("table").getByRole("link")).toHaveCount(0);
        await page.evaluate(() => {
          (window as any).mode = "DATA";
        });
        await retry.click();
        await expect(page.getByRole("table")).toContainText("tenant-a");
      }
      // A held old-tenant response must not win after the new tenant resolves.
      await page.evaluate(() => {
        (window as any).mode = "HOLD";
      });
      if (moduleId === "procurement")
        await page.getByLabel("Fixture tenant").selectOption("tenant-a");
      else await refresh.click();
      await expect(loading).toBeVisible();
      await page.evaluate(() => {
        (window as any).mode = "DATA";
      });
      await page.getByLabel("Fixture tenant").selectOption("tenant-b");
      await expect(page.getByRole("table").first()).toContainText("tenant-b");
      await page.evaluate(() => (window as any).releaseOld());
      await expect(page.getByRole("table").first()).not.toContainText("tenant-a");
      const calls = await page.evaluate(() => (window as any).reads);
      expect(calls.every((call: any) => call.method === "GET" && Boolean(call.tenantId))).toBe(
        true
      );
      expect(errors).toEqual([]);
      if (moduleId === "inventory")
        expect(
          (await page.getByRole("button", { name: "tenant-b", exact: true }).boundingBox())!.height
        ).toBeLessThan(80);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      await page.screenshot({ path: `/tmp/nox-ui-v3/registry-${moduleId}-${width}.png` });
    });
