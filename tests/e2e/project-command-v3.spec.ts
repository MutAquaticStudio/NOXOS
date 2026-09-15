import { build } from "esbuild";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const width of [1280, 320]) {
  test(`Project command confirmation and uncertain-result recovery at ${width}px`, async ({
    page
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("dialog", async (dialog) => {
      errors.push("Unexpected native dialog");
      await dialog.dismiss();
    });
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
        import {ProjectOperationsExperience} from './project-operations';
        import {projectOperationsPermissions as grants} from '../../../packages/project-operations/src/authorization';
        window.calls=[];window.mode='READY';window.updates=[];
        const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
        async function api(path,options={}){
          window.calls.push({path,...options});
          if(options.method==='POST'){
            if(window.mode==='PENDING') return new Promise((resolve,reject)=>{window.rejectCommand=()=>reject(Error('Private SQL diagnostic'));});
            if(path.endsWith('/updates'))window.updates.push({id:String(window.updates.length),summary:options.body.summary,update_type:options.body.updateType});
            if(window.mode==='READ_FAILURE_AFTER_SAVE')window.mode='READ_FAILURE';
            return {};
          }
          if(window.mode==='READ_FAILURE')throw Error('Private diagnostic');
          return {project:{id,tenant_id:options.tenantId,project_code:'OPS-01',name:'Review project',status:'ACTIVE',project_type:'INTERNAL',updated_at:'v1',revision:'123.123456'},
            phases:[],phaseState:[],tasks:[],dependencies:[],links:[],updates:window.updates,scope:[]};
        }
        function App(){const [allowed,setAllowed]=useState(true);window.setAllowed=setAllowed;
          return <NoxShell theme="DARK" density="DEFAULT" activeRoute="/project-operations" railItems={[]} onNavigate={()=>{}}>
            <Routes><Route path="/project-operations/*" element={<ProjectOperationsExperience api={api} tenantId="tenant-a"
              modulePermissions={allowed?Object.values(grants):[grants.read]}/>}/></Routes>
          </NoxShell>;}
        createRoot(document.getElementById('root')).render(<BrowserRouter><App/></BrowserRouter>);
      `
      },
      bundle: true,
      write: false,
      outfile: "project-command.js",
      platform: "browser",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' }
    });
    await page.route("**/*", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>NØX Project commands</title></head><body><div id="root"></div></body></html>'
      })
    );
    await page.goto("/project-operations/projects/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    for (const output of bundle.outputFiles)
      if (output.path.endsWith(".css")) await page.addStyleTag({ content: output.text });
      else await page.addScriptTag({ content: output.text });
    await expect(page).toHaveTitle("NØX Project commands");
    await expect(page.getByRole("heading", { name: "OPS-01 · Review project" })).toBeVisible();
    const posts = () =>
      page.evaluate(() => (window as any).calls.filter((call: any) => call.method === "POST"));
    await page.getByRole("button", { name: "Hold", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "Hold Project", exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Reason", { exact: true }).fill("   ");
    await expect(dialog.getByRole("button", { name: "Confirm Hold Project" })).toBeDisabled();
    await dialog.getByLabel("Reason", { exact: true }).fill("Waiting for evidence");
    await page.keyboard.press("Escape");
    await expect(dialog.getByText("Discard this form?", { exact: false })).toBeVisible();
    await dialog.getByRole("button", { name: "Keep editing" }).click();
    expect(await posts()).toHaveLength(0);
    expect(
      (await new AxeBuilder({ page }).analyze()).violations.filter((v) =>
        ["serious", "critical"].includes(v.impact ?? "")
      )
    ).toEqual([]);
    mkdirSync("/tmp/nox-ui-v3", { recursive: true });
    await page.screenshot({ path: `/tmp/nox-ui-v3/project-command-${width}.png` });
    await page.evaluate(() => {
      (window as any).mode = "PENDING";
    });
    await dialog.locator("form").evaluate((form) => {
      (form as HTMLFormElement).requestSubmit();
      (form as HTMLFormElement).requestSubmit();
    });
    await expect.poll(async () => (await posts()).length).toBe(1);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await page.evaluate(() => (window as any).rejectCommand());
    await expect(
      dialog.getByText("The request could not be confirmed.", { exact: false })
    ).toBeVisible();
    await expect(dialog.getByLabel("Reason", { exact: true })).toHaveValue("Waiting for evidence");
    await expect(dialog.getByRole("button", { name: "Confirm Hold Project" })).toBeDisabled();
    await page.evaluate(() => {
      (window as any).mode = "READY";
    });
    await dialog.getByRole("button", { name: "Reload current data only" }).click();
    expect(await posts()).toHaveLength(1);
    await expect(dialog.getByRole("button", { name: "Confirm Hold Project" })).toBeDisabled();
    await dialog.getByRole("button", { name: "Back without submitting" }).click();
    await dialog.getByRole("button", { name: "Discard form" }).click();
    await expect(page.getByRole("button", { name: "Hold", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Add note", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Add note", exact: true });
    await dialog.getByLabel("Update summary").fill("Recorded once");
    await page.evaluate(() => {
      (window as any).mode = "READ_FAILURE_AFTER_SAVE";
    });
    await dialog.getByRole("button", { name: "Confirm Add note" }).click();
    await expect(
      dialog.getByText("The server accepted the change", { exact: false })
    ).toBeVisible();
    await page.evaluate(() => {
      (window as any).mode = "READY";
    });
    await dialog.getByRole("button", { name: "Reload current data only" }).click();
    await expect(page.getByLabel("Internal update timeline")).toContainText("Recorded once");
    expect(await posts()).toHaveLength(2);
    await dialog.getByRole("button", { name: "Back without submitting" }).click();
    await dialog.getByRole("button", { name: "Discard form" }).click();
    await page.getByRole("button", { name: "Add progress", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Add progress", exact: true });
    await dialog.getByLabel("Update summary").fill("  Evidence collected  ");
    await dialog.getByRole("button", { name: "Confirm Add progress" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByLabel("Internal update timeline")).toContainText(
      "PROGRESS: Evidence collected"
    );
    const mutations = await posts();
    expect(mutations).toHaveLength(3);
    for (const mutation of mutations) {
      expect(mutation.body.expectedRevision).toBe("123.123456");
      expect(mutation.body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(new Set(mutations.map((mutation: any) => mutation.body.idempotencyKey)).size).toBe(3);
    expect(mutations[0]).toMatchObject({
      tenantId: "tenant-a",
      body: { reason: "Waiting for evidence" }
    });
    expect(mutations[2]).toMatchObject({
      tenantId: "tenant-a",
      body: {
        updateType: "PROGRESS",
        summary: "Evidence collected",
        phasePlanId: null,
        taskId: null,
        resolvesUpdateId: null
      }
    });
    await page.getByRole("button", { name: "Complete", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Complete Project", exact: true });
    await page.evaluate(() => (window as any).setAllowed(false));
    await expect(dialog.getByRole("alert")).toContainText("State or permission changed");
    await expect(dialog.getByRole("button", { name: "Confirm Complete Project" })).toBeDisabled();
    expect(await posts()).toHaveLength(3);
    await expect(page.locator("body")).not.toContainText("Private SQL");
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    expect(errors).toEqual([]);
  });
}
