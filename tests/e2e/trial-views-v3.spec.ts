import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const width of [1440, 390])
  test(`Trial preparation and sensory views preserve draft and history at ${width}px`, async ({
    page
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    const result = await build({
      stdin: {
        loader: "tsx",
        resolveDir: resolve("apps/nox-os/src"),
        contents: `
      import {createRoot} from 'react-dom/client';
      import {BrowserRouter,Routes,Route,useLocation,useNavigate} from 'react-router-dom';
      import {TrialSensoryExperience} from './trial-sensory';
      import {NoxShell} from '@nox-os/ui';
      import '../../../packages/ui/src/styles.css';
      const trialId='22222222-2222-4222-8222-222222222222', formulaId='11111111-1111-4111-8111-111111111111';
      window.mutations=[];
      const api=async(path,options={})=>{
        if(options.method){ window.mutations.push(path); throw Error('This view-only fixture must not mutate'); }
        if(path.startsWith('/materials/taxonomy')) return {taxonomy:{GRAND_FAMILIES:[],SUBFAMILIES:[],DESCRIPTORS:[],TEXTURES:[],SENSATIONS:[]}};
        if(path.startsWith('/design-studio/formula-versions/')) return {formulaVersion:{formulaVersionId:formulaId,versionNumber:1,status:'FROZEN',approvalState:'NOT_APPROVED',bundleHash:'frozen-hash',candidate:{projectId:trialId,sourceBriefId:formulaId}}};
        return {trial:{id:trialId,tenantId:'tenant-a',formulaVersionId:formulaId,formulaBundleHash:'frozen-hash',compositionKind:'FULL_FORMULA',status:'PREPARED',preparedAt:'2026-09-05',updatedAt:'2026-09-05',lines:[],preparation:{preparationMode:'CONCENTRATE',applicationKey:'fine-fragrance',dosagePct:20,carrierOrBaseReference:null,targetMassMg:'20000'}},
          formula:{formulaVersionId:formulaId,name:'Prepared fixture',versionNumber:1,compositionKind:'FULL_FORMULA',lines:[]},
          evaluation:{id:'33333333-3333-4333-8333-333333333333',trialId,status:'DRAFT',context:{evaluationMedium:'BLOTTER',sampleAgeMinutes:0},evaluationText:'Original observation',diagnosticNote:null,decision:null,finalizedAt:null,deltas:[]}};
      };
      function App(){const location=useLocation(),navigate=useNavigate();return <NoxShell theme="DARK" density="DEFAULT" activeRoute={location.pathname} railItems={[]} onNavigate={navigate}><p>Offline UI fixture; no provider authentication.</p><Routes><Route path="/trials/*" element={<TrialSensoryExperience api={api} tenantId="tenant-a" modulePermissions={['module.design-studio.studio.read','module.trial-sensory.trial.read','module.trial-sensory.evaluation.edit']}/>}/></Routes></NoxShell>}
      createRoot(document.getElementById('root')).render(<BrowserRouter><App/></BrowserRouter>);
    `
      },
      bundle: true,
      write: false,
      outfile: "fixture.js",
      jsx: "automatic",
      alias: { "@nox-os/ui": resolve("packages/ui/src/index.tsx") },
      platform: "browser",
      define: { "process.env.NODE_ENV": '"production"' }
    });
    await page.route("**/trials/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html lang="en"><head><title>Trial workspace UI fixture</title></head><body><div id="root"></div></body></html>'
      })
    );
    await page.goto("/trials/22222222-2222-4222-8222-222222222222?view=preparation");
    for (const output of result.outputFiles) {
      if (output.path.endsWith(".css")) await page.addStyleTag({ content: output.text });
      else await page.addScriptTag({ content: output.text });
    }
    await expect(page.getByRole("heading", { name: "Preparation", exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Development lifecycle" })).toContainText(
      "Evaluation in progress"
    );
    await expect(
      page.getByRole("heading", { name: "Sensory Evaluation", exact: true })
    ).toBeHidden();
    await page.getByRole("button", { name: "Sensory · Draft", exact: true }).click();
    await expect(page).toHaveURL(/view=sensory/);
    const observation = page.getByRole("textbox", {
      name: "What did this sample smell like?",
      exact: true
    });
    await observation.fill("Human observation must survive view changes");
    await page.getByRole("button", { name: /^Preparation ·/ }).click();
    await expect(observation).toBeHidden();
    await page.goBack();
    await expect(observation).toHaveValue("Human observation must survive view changes");
    expect(
      await page.evaluate(() => (window as Window & { mutations?: string[] }).mutations)
    ).toEqual([]);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    expect(errors).toEqual([]);
    mkdirSync("/tmp/nox-ui-v3", { recursive: true });
    await page.screenshot({ path: `/tmp/nox-ui-v3/trial-sensory-${width}.png` });
  });
