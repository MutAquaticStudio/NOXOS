import { build } from "esbuild";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { arbitrateIntent } from "../../packages/design-studio/src/intent";

async function mount(
  page: Page,
  mode: "valid" | "wrong-lineage" | "no-permission" | "rejected" | "creation-retry"
) {
  // The fake API computes its response in the Node test runner, not in client code.
  await page.exposeFunction("fixtureArbitrate", (rawBriefSummary: string) =>
    arbitrateIntent({
      rawBriefSummary,
      applicationProfile: { applicationKey: "fine-fragrance", targetDosagePct: 20 },
      explicitTags: [],
      explicitExclusions: [],
      signals: []
    })
  );
  const code = await build({
    stdin: {
      loader: "tsx",
      resolveDir: resolve("apps/nox-os/src"),
      contents: `
      import {createRoot} from 'react-dom/client';
      import {MemoryRouter} from 'react-router-dom';
      import {DesignStudioExperience} from './design-studio';
      import {NoxShell} from '../../../packages/ui/src/index';
      import '../../../packages/ui/src/styles.css';
      const mode=${JSON.stringify(mode)};
      const formulaId='11111111-1111-4111-8111-111111111111', trialId='22222222-2222-4222-8222-222222222222', evaluationId='33333333-3333-4333-8333-333333333333';
      const formula={formulaVersionId:formulaId,name:'Fixture Formula',bundleHash:'frozen-hash',status:'FROZEN',approvalState:'NOT_APPROVED',compositionKind:'FULL_FORMULA',versionNumber:1,candidate:{projectId:trialId,sourceBriefId:evaluationId,lines:[]}};
      window.mutations=[];
      let projectCalls=0, briefCalls=0;
      const api=async(path,options={})=>{
        if(mode==='creation-retry' && options.method==='POST'){
          window.mutations.push({path,options});
          if(path==='/design-studio/projects'){
            if(++projectCalls===1) throw Error('Project response lost');
            return {project:{id:formulaId}};
          }
          if(++briefCalls===1) throw Error('Brief response lost');
          return {brief:{id:trialId},intentDraft:await window.fixtureArbitrate(options.body.rawBrief)};
        }
        if(options.method==='POST'){window.mutations.push({path,options});if(mode==='rejected')throw Error('APPROVAL_EVIDENCE_INVALID');return {formulaVersion:{...formula,approvalState:'APPROVED'}};}
        if(path.startsWith('/trials/'))return {trial:{id:trialId,tenantId:'tenant-a',status:'COMPLETED',formulaVersionId:mode==='wrong-lineage'?'different-formula':formulaId,formulaBundleHash:'frozen-hash'},evaluation:{id:evaluationId,trialId,status:'FINAL',decision:'READY_FOR_APPROVAL'}};
        if(path.startsWith('/design-studio/formula-versions/'))return {formulaVersion:formula};
        return {taxonomy:{GRAND_FAMILIES:['Floral'],SUBFAMILIES:[],DESCRIPTORS:[],TEXTURES:[],SENSATIONS:[]}};
      };
      const permissions=['module.design-studio.studio.read','module.design-studio.brief.manage',...(mode==='no-permission'?[]:['module.design-studio.formula.approve'])];
      const route=mode==='creation-retry'?'/design-studio':'/design-studio/formula-versions/'+formulaId+'?sourceTrialId='+trialId+'&sourceEvaluationId='+evaluationId;
      createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={[route]}><NoxShell theme="DARK" density="DEFAULT" activeRoute={route.split('?')[0]} railItems={[]} onNavigate={()=>{}}><DesignStudioExperience api={api} tenantId="tenant-a" modulePermissions={permissions}/></NoxShell></MemoryRouter>);
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
  const html =
    '<html lang="en"><head><title>G4 UI fixture</title></head><body><div id="root"></div></body></html>';
  // Loopback secure context provides the real browser crypto.randomUUID API.
  await page.route("**/g4-ui-fixture", (route) =>
    route.fulfill({ contentType: "text/html", body: html })
  );
  await page.goto("/g4-ui-fixture");
  for (const file of code.outputFiles) {
    if (file.path.endsWith(".css")) await page.addStyleTag({ content: file.text });
    else if (file.path.endsWith(".js")) await page.addScriptTag({ content: file.text });
  }
  if (mode !== "creation-retry")
    await expect(page.getByRole("heading", { name: "Fixture Formula · v1" })).toBeVisible();
}

test("G4 approval requires explicit confirmation and preserves exact G5 evidence", async ({
  page
}) => {
  await mount(page, "valid");
  await expect(page.getByRole("navigation", { name: "Development lifecycle" })).toContainText(
    "Approval Review"
  );
  await page.getByRole("button", { name: "Approve Formula", exact: true }).click();
  expect(
    await page.evaluate(() => (window as unknown as { mutations: unknown[] }).mutations)
  ).toEqual([]);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    await page.evaluate(() => (window as unknown as { mutations: unknown[] }).mutations)
  ).toEqual([]);
  await page.getByRole("button", { name: "Approve Formula", exact: true }).click();
  await page.getByRole("button", { name: "Confirm approval", exact: true }).click();
  await expect(page.getByText("FROZEN · APPROVED", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => (window as unknown as { mutations: unknown[] }).mutations)
  ).toEqual([
    {
      path: "/design-studio/formula-versions/11111111-1111-4111-8111-111111111111/approve",
      options: {
        method: "POST",
        tenantId: "tenant-a",
        body: {
          sourceTrialId: "22222222-2222-4222-8222-222222222222",
          sourceEvaluationId: "33333333-3333-4333-8333-333333333333"
        }
      }
    }
  ]);
});

for (const mode of ["wrong-lineage", "no-permission"] as const)
  test(`G4 blocks ${mode}`, async ({ page }) => {
    await mount(page, mode);
    await expect(page.getByRole("button", { name: "Approve Formula", exact: true })).toHaveCount(0);
    expect(
      await page.evaluate(() => (window as unknown as { mutations: unknown[] }).mutations)
    ).toEqual([]);
  });

test("server rejection does not optimistically approve the Formula", async ({ page }) => {
  await mount(page, "rejected");
  await page.getByRole("button", { name: "Approve Formula", exact: true }).click();
  await page.getByRole("button", { name: "Confirm approval", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("APPROVAL_EVIDENCE_INVALID");
  await expect(page.getByText("FROZEN · NOT_APPROVED", { exact: true })).toBeVisible();
});

test("creation retries retain operation keys; changed Brief receives a new key without recreating Project", async ({
  page
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mount(page, "creation-retry");
  await expect(page).toHaveTitle("G4 UI fixture");
  await page.getByRole("button", { name: /Complete Formula/ }).click();
  const raw = page.getByRole("textbox", { name: "Creative brief", exact: true });
  await raw.fill("Original observations");
  const submit = page.getByRole("button", { name: "Interpret Brief", exact: true });
  await submit.click();
  await expect(page.getByRole("alert")).toHaveText("Project response lost");
  await submit.click();
  await expect(page.getByRole("alert")).toHaveText("Brief response lost");
  await expect(raw).toHaveValue("Original observations");
  await submit.click();
  await expect(page.getByRole("heading", { name: "Intent Review", exact: true })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "response lost" })).toHaveCount(0);
  await raw.fill("Revised observations");
  await submit.click();
  await expect(page.locator("p").filter({ hasText: /^Revised observations$/ })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "response lost" })).toHaveCount(0);
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as {
          mutations: {
            path: string;
            options: { body: { operationKey: string; rawBrief?: string } };
          }[];
        }
      ).mutations
  );
  const projects = calls.filter((call) => call.path === "/design-studio/projects");
  const briefs = calls.filter((call) => call.path.endsWith("/briefs"));
  expect(projects).toHaveLength(4);
  expect(new Set(projects.map((call) => call.options.body.operationKey)).size).toBe(1);
  expect(briefs).toHaveLength(3);
  expect(briefs[0].options.body.operationKey).toBe(briefs[1].options.body.operationKey);
  expect(briefs[2].options.body.operationKey).not.toBe(briefs[1].options.body.operationKey);
  expect(briefs[2].options.body.rawBrief).toBe("Revised observations");
  expect(projects[0].options.body.operationKey).toMatch(/^[0-9a-f-]{36}$/);
  expect(errors).toEqual([]);
});
