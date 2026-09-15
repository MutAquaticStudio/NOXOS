import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const mode of [
  "valid",
  "valid-mobile",
  "read-only",
  "wrong-lineage",
  "wrong-response"
] as const)
  test(`Sensory → Design Studio revision ${mode}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: mode === "valid" ? 1440 : 390, height: 900 });
    const code = await build({
      stdin: {
        loader: "tsx",
        resolveDir: resolve("apps/nox-os/src"),
        contents: `
      import {createRoot} from 'react-dom/client';
      import {BrowserRouter,Routes,Route,useLocation,useNavigate} from 'react-router-dom';
      import {TrialSensoryExperience} from './trial-sensory';
      import {DesignStudioExperience} from './design-studio';
      import {NoxShell} from '@nox-os/ui';
      import '../../../packages/ui/src/styles.css';
      const mode=${JSON.stringify(mode)},f='11111111-1111-4111-8111-111111111111',t='22222222-2222-4222-8222-222222222222',e='33333333-3333-4333-8333-333333333333',next='44444444-4444-4444-8444-444444444444';
      const candidate={candidateId:'candidate-1',projectId:t,sourceBriefId:e,compositionKind:'FULL_FORMULA',generationStrategy:'FAITHFUL',engineVersion:'fixture-v1',taxonomyVersion:'osmo_v1.2',lines:[{materialId:f,normalizedMassMg:'1000000',activeAromaticMassMg:'1000000',carrierSolventMassMg:'0',contributionEvidence:[],materialSnapshot:{snapshotHash:'snapshot',material:{displayName:'Reference Material',materialType:'SINGLE_MOLECULE',approvalStatus:'APPROVED',noteClassification:'MID'},identifiers:{},odorAssignments:[]}}],validation:{structuralValidation:'PASS',materialEligibility:'PASS',knownLimitScreening:'REVIEW_REQUIRED',unresolvedConstraints:[],warnings:[]},scientificContext:{capability:'CURATED_ONLY'}};
      const parent={formulaVersionId:f,tenantId:'tenant-a',name:'Immutable Parent',versionNumber:1,status:'FROZEN',approvalState:'NOT_APPROVED',bundleHash:'hash',compositionKind:'FULL_FORMULA',candidate};
      const trial={id:t,tenantId:'tenant-a',formulaVersionId:f,formulaBundleHash:mode==='wrong-lineage'?'wrong':'hash',status:'COMPLETED',compositionKind:'FULL_FORMULA',preparation:{preparationMode:'CONCENTRATE',applicationKey:'fine-fragrance',dosagePct:20,targetMassMg:'20000'},lines:[],preparedAt:'2026-09-05',updatedAt:'2026-09-05'};
      const evaluation={id:e,trialId:t,status:'FINAL',decision:'REVISION_REQUIRED',evaluationText:'Human observation: soften the opening.\\nKeep the drydown.',diagnosticNote:'Confirmed by evaluator.',finalizedAt:'2026-09-05',context:{evaluationMedium:'BLOTTER',sampleAgeMinutes:0},deltas:[]};
      const revised={...parent,formulaVersionId:next,parentFormulaVersionId:f,name:'New Revision',versionNumber:2};
      window.mutations=[];
      const api=async(path,options={})=>{
        if(options.method){window.mutations.push({path,options});
          if(path.endsWith('/create-revision'))return {revisionContext:{parentFormulaVersionId:mode==='wrong-response'?next:f,sourceTrialId:t,sourceEvaluationId:e},candidates:[candidate]};
          if(path.endsWith('/revisions/freeze'))return {formulaVersion:revised};
          throw Error('Unexpected mutation');
        }
        if(path.startsWith('/materials/taxonomy'))return {taxonomy:{GRAND_FAMILIES:[],SUBFAMILIES:[],DESCRIPTORS:[],TEXTURES:[],SENSATIONS:[]}};
        if(path.startsWith('/design-studio/formula-versions/'))return {formulaVersion:path.endsWith(next)?revised:parent};
        return {trial,evaluation,formula:{formulaVersionId:f,name:parent.name,versionNumber:1,compositionKind:'FULL_FORMULA',lines:[]}};
      };
      const permissions=['module.trial-sensory.trial.read','module.design-studio.studio.read',...(mode==='read-only'?[]:['module.trial-sensory.revision.request','module.design-studio.formula.freeze'])];
      function App(){const location=useLocation(),navigate=useNavigate();return <NoxShell theme="DARK" density="DEFAULT" activeRoute={location.pathname} railItems={[]} onNavigate={navigate}><p>Offline revision UI fixture — no provider authentication.</p><Routes><Route path="/trials/*" element={<TrialSensoryExperience api={api} tenantId="tenant-a" modulePermissions={permissions}/>}/><Route path="/design-studio/*" element={<DesignStudioExperience api={api} tenantId="tenant-a" modulePermissions={permissions}/>}/></Routes></NoxShell>}
      createRoot(document.getElementById('root')).render(<BrowserRouter><App/></BrowserRouter>);
    `
      },
      bundle: true,
      write: false,
      outfile: "fixture.js",
      jsx: "automatic",
      alias: { "@nox-os/ui": resolve("packages/ui/src/index.tsx") },
      define: { "process.env.NODE_ENV": '"production"' },
      platform: "browser"
    });
    await page.route("**/trials/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html lang="en"><head><title>Revision UI fixture</title></head><body><div id="root"></div></body></html>'
      })
    );
    await page.goto("/trials/22222222-2222-4222-8222-222222222222?view=sensory");
    for (const file of code.outputFiles) {
      if (file.path.endsWith(".css")) await page.addStyleTag({ content: file.text });
      else await page.addScriptTag({ content: file.text });
    }
    await expect(page).toHaveTitle("Revision UI fixture");
    await expect(page.getByRole("button", { name: "Create Revision Candidates" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Freeze Revision/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Review revision in Design Studio" }).click();
    await expect(page).toHaveURL(
      /\/design-studio\/formula-versions\/11111111.*sourceTrialId=22222222.*sourceEvaluationId=33333333/
    );
    expect(
      await page.evaluate(() => (window as Window & { mutations?: unknown[] }).mutations)
    ).toEqual([]);
    if (mode === "wrong-lineage") {
      await expect(page.getByRole("alert")).toContainText("Revision evidence does not match");
      await expect(page.getByRole("button", { name: "Generate revision directions" })).toHaveCount(
        0
      );
      return;
    }
    const review = page.getByRole("region", { name: "Formula revision review" });
    await expect(review).toContainText("Human observation: soften the opening.");
    if (mode === "read-only") {
      await expect(review).toContainText("Read-only evidence");
      await expect(review.getByRole("button")).toHaveCount(0);
      return;
    }
    await review.getByRole("button", { name: "Generate revision directions" }).click();
    if (mode === "wrong-response") {
      await expect(review.getByRole("alert")).toContainText("does not match");
      await expect(review.getByRole("button", { name: "Use This Formula" })).toHaveCount(0);
      return;
    }
    await expect(review.getByRole("heading", { name: "Formula candidates" })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    expect(
      await page
        .locator(".nox-workspace-content")
        .evaluate((element) => element.scrollWidth <= element.clientWidth)
    ).toBe(true);
    mkdirSync("/tmp/nox-ui-v3", { recursive: true });
    await page.screenshot({
      path: `/tmp/nox-ui-v3/revision-review-${mode === "valid" ? 1440 : 390}.png`
    });
    await review.getByRole("button", { name: "Use This Formula" }).click();
    await page.getByRole("button", { name: "Confirm Freeze", exact: true }).click();
    await expect(page).toHaveURL(/formula-versions\/44444444-4444-4444-8444-444444444444$/);
    const mutations = await page.evaluate(
      () =>
        (window as Window & { mutations?: Array<{ path: string; options: { body?: unknown } }> })
          .mutations
    );
    expect(mutations?.map((item) => item.path)).toEqual([
      "/trials/22222222-2222-4222-8222-222222222222/evaluations/33333333-3333-4333-8333-333333333333/create-revision",
      "/design-studio/formula-versions/11111111-1111-4111-8111-111111111111/revisions/freeze"
    ]);
    expect(mutations?.[1]?.options.body).toMatchObject({
      sourceTrialId: "22222222-2222-4222-8222-222222222222",
      sourceEvaluationId: "33333333-3333-4333-8333-333333333333",
      strategy: "FAITHFUL"
    });
    expect(errors).toEqual([]);
  });
