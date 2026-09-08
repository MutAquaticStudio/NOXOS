import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const width of [1440, 390])
  test(`Exact-lineage spine read navigation at ${width}px`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    const result = await build({
      stdin: {
        loader: "tsx",
        resolveDir: resolve("apps/nox-os/src"),
        contents: `
      import {createRoot} from 'react-dom/client';
      import {useMemo,useState} from 'react';
      import {NoxShell,useWorkspaceObject} from '@nox-os/ui';
      import {resolveDevelopmentContext} from './development-context';
      import '../../../packages/ui/src/styles.css';
      const formulaId='11111111-1111-4111-8111-111111111111',trialId='22222222-2222-4222-8222-222222222222',evaluationId='33333333-3333-4333-8333-333333333333';
      const route='/design-studio/formula-versions/'+formulaId;
      function Content(){const [invalid,setInvalid]=useState(false);const object=useMemo(()=>({id:formulaId,objectType:'FormulaVersion',title:'Frozen version 2',route,readOnly:true,properties:[],development:resolveDevelopmentContext({tenantId:'tenant-a',queryTenantId:invalid?'other':'tenant-a',formulaVersionId:formulaId,formula:{formulaVersionId:formulaId,versionNumber:2,bundleHash:'hash',status:'FROZEN',approvalState:'NOT_APPROVED',candidate:{projectId:trialId,sourceBriefId:evaluationId}},selectedTrialId:trialId,selectedEvaluationId:evaluationId,trial:{id:trialId,tenantId:'tenant-a',formulaVersionId:formulaId,formulaBundleHash:'hash',status:'COMPLETED'},evaluation:{id:evaluationId,trialId,status:'FINAL',decision:'READY_FOR_APPROVAL'},permissions:['module.design-studio.studio.read','module.trial-sensory.trial.read']})}),[invalid]);useWorkspaceObject(object);return <><h1>Frozen Formula · version 2</h1><p>Offline UI fixture. No authentication or backend acceptance.</p><button onClick={()=>setInvalid(true)}>Simulate conflicting lineage</button></>}
      window.readRoutes=[];
      createRoot(document.getElementById('root')).render(<NoxShell theme="DARK" density="DEFAULT" activeRoute={route} railItems={[]} onNavigate={href=>window.readRoutes.push(href)}><Content/></NoxShell>);
    `
      },
      bundle: true,
      write: false,
      outfile: "fixture.js",
      jsx: "automatic",
      alias: { "@nox-os/ui": resolve("packages/ui/src/index.tsx") },
      define: { "process.env.NODE_ENV": '"production"' }
    });
    await page.route("**/phase-fixture", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html lang="en"><head><title>Development Spine fixture</title></head><body><div id="root"></div></body></html>'
      })
    );
    await page.goto("/phase-fixture");
    for (const file of result.outputFiles) {
      if (file.path.endsWith(".css")) await page.addStyleTag({ content: file.text });
      else await page.addScriptTag({ content: file.text });
    }
    await expect(page).toHaveTitle("Development Spine fixture");
    await expect(page.getByRole("heading", { name: "Frozen Formula · version 2" })).toBeVisible();
    const spine = page.getByRole("navigation", { name: "Development lifecycle" });
    if (width < 900) await spine.locator("summary").click();
    await expect(spine.getByRole("button", { name: /Readiness/ })).toHaveAttribute(
      "aria-current",
      "step"
    );
    await spine.getByRole("button", { name: /^Trial/ }).click();
    expect(
      await page.evaluate(() => (window as Window & { readRoutes?: string[] }).readRoutes)
    ).toEqual(["/trials/22222222-2222-4222-8222-222222222222?view=preparation"]);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    mkdirSync("/tmp/nox-ui-v3", { recursive: true });
    await page.screenshot({ path: `/tmp/nox-ui-v3/development-spine-${width}.png` });
    if (width < 900) {
      await spine.getByRole("button", { name: /^Trial/ }).press("Escape");
      await expect(spine.locator("summary")).toBeFocused();
      await expect(spine.getByRole("button", { name: /^Trial/ })).toBeHidden();
    }
    await page.getByRole("button", { name: "Simulate conflicting lineage" }).click();
    await expect(spine).toContainText("Unknown phase");
    await expect(spine.getByRole("button")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
