import { build } from "esbuild";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const width of [1280, 1024, 768, 320]) {
  test(`Operational Project exact context, permissions and read recovery at ${width}px`, async ({
    page
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
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
      window.mode='HOLD';window.calls=[];window.pending=[];
      const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      function payload(tenantId){return {project:{id,tenant_id:tenantId,name:'Project '+tenantId,
        project_code:'OPS-01',project_type:'INTERNAL',status:'ACTIVE',priority:'NORMAL',owner_user_id:'Operator'},
        phases:[{id:'phase',phase_key:'DESIGN'}],phaseState:[],tasks:[],dependencies:[],links:[],updates:[],scope:[]};}
      async function api(path,options={}){
        window.calls.push({path,...options});
        if(options.method&&options.method!=='GET')throw Error('Unexpected mutation');
        if(window.mode==='HOLD')return new Promise((resolve,reject)=>window.pending.push({resolve,reject,tenantId:options.tenantId}));
        if(window.mode==='ERROR')throw Error('Private database credentials must not render');
        const result=payload(options.tenantId);
        if(window.mode==='WRONG_ID')result.project.id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
        if(window.mode==='WRONG_TENANT')result.project.tenant_id='other-tenant';
        if(window.mode==='MISSING_TASKS')delete result.tasks;
        if(window.mode==='POPULATED'){
          result.phases=[{id:'phase',phase_key:'DESIGN',required:true,owner_display_name:'Fixture operator',planned_due_date:'2026-09-09'}];
          result.phaseState=[{id:'phase',state:'REVISION_REQUIRED'}];
          result.tasks=[{id:'task-a',title:'Review formulation',task_kind:'TASK',status:'TODO',required:true},
            {id:'task-b',title:'Record trial evidence',task_kind:'MILESTONE',status:'DONE',required:false,assignee_display_name:'Fixture reviewer',due_date:'2026-09-08'}];
          result.dependencies=[{id:'dep',predecessor_task_id:'task-a',successor_task_id:'task-b'}];
          result.links=[{id:'link',artifact_type:'FORMULA_VERSION',artifact_id:id,relationship:'EVIDENCE',status:'REVOKED',revocation_reason:'Superseded link'}];
          result.updates=[{id:'update',update_type:'NOTE',summary:'<img src=x onerror=alert(1)> treated as text',created_at:'2026-09-05T12:00:00Z',created_by_user_id:'fixture-actor'}];
        }
        return result;
      }
      window.releaseOld=()=>window.pending.splice(0).forEach(p=>p.resolve(payload(p.tenantId)));
      function App(){const [tenant,setTenant]=useState('tenant-a');const [read,setRead]=useState(true);
        window.setRead=setRead;
        return <NoxShell theme="DARK" density="DEFAULT" activeRoute="/project-operations" railItems={[]} onNavigate={()=>{}}
          tenantControl={<label>Test tenant<select value={tenant} onChange={e=>setTenant(e.target.value)}><option>tenant-a</option><option>tenant-b</option></select></label>}>
          <Routes><Route path="/project-operations/*" element={<ProjectOperationsExperience api={api} tenantId={tenant}
            modulePermissions={read?['module.project-operations.read']:[]}/>}/></Routes>
        </NoxShell>;}
      createRoot(document.getElementById('root')).render(<BrowserRouter><App/></BrowserRouter>);
    `
      },
      bundle: true,
      write: false,
      outfile: "project-fixture.js",
      platform: "browser",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' }
    });
    await page.route("**/*", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>NØX Project detail fixture</title></head><body><div id="root"></div></body></html>'
      })
    );
    await page.goto("/project-operations/projects/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    for (const output of bundle.outputFiles)
      if (output.path.endsWith(".css")) await page.addStyleTag({ content: output.text });
      else await page.addScriptTag({ content: output.text });
    await expect(page).toHaveTitle("NØX Project detail fixture");
    await expect(
      page.getByRole("status").filter({ hasText: "Loading Operational Project data" })
    ).toBeVisible();
    await page.evaluate(() => {
      for (const p of (window as any).pending.splice(0)) p.reject(Error("Secret diagnostic"));
    });
    const retry = page.getByRole("button", { name: "Retry Operational Project", exact: true });
    await expect(retry).toBeVisible();
    for (const mode of ["WRONG_ID", "WRONG_TENANT", "MISSING_TASKS"]) {
      await page.evaluate((mode) => {
        (window as any).mode = mode;
      }, mode);
      await retry.click();
      await expect(retry).toBeVisible();
      await expect(page.getByRole("heading", { name: "OPS-01 · Project tenant-a" })).toHaveCount(0);
    }
    await page.evaluate(() => {
      (window as any).mode = "READY";
    });
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "OPS-01 · Project tenant-a" })).toBeVisible();
    await expect(
      page.getByText("Internal updates are read-only with your current permissions.")
    ).toBeVisible();
    for (const name of ["Hold", "Complete", "Cancel", "Add progress", "Add blocker", "Add note"])
      await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Derived phase plan")).toContainText("State unavailable");
    await expect(page.getByLabel("Derived phase plan")).not.toContainText("NOT_STARTED");
    await expect(page.locator("body")).not.toContainText("Secret diagnostic");
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    expect(
      (await new AxeBuilder({ page }).analyze()).violations.filter((v) =>
        ["critical", "serious"].includes(v.impact ?? "")
      )
    ).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    mkdirSync("/tmp/nox-ui-v3", { recursive: true });
    await page.screenshot({ path: "/tmp/nox-ui-v3/project-detail-read-" + width + ".png" });
    await page.evaluate(() => {
      (window as any).mode = "POPULATED";
    });
    await page.getByRole("button", { name: "Refresh Operational Project", exact: true }).click();
    await expect(
      page.getByRole("table", { name: "Tasks and milestones", exact: true })
    ).toContainText("Record trial evidence");
    await expect(
      page.getByRole("table", { name: "Derived phase plan", exact: true })
    ).toContainText("REVISION_REQUIRED");
    await expect(page.getByRole("table", { name: "Artifact lineage", exact: true })).toContainText(
      "Superseded link"
    );
    await expect(
      page.getByText("Review formulation → Record trial evidence", { exact: true })
    ).toBeVisible();
    await expect(page.getByLabel("Internal update timeline")).toContainText(
      "<img src=x onerror=alert(1)> treated as text"
    );
    await expect(page.getByLabel("Internal update timeline").locator("img")).toHaveCount(0);
    await expect(page.getByLabel("Internal update timeline").locator("time")).toHaveAttribute(
      "datetime",
      "2026-09-05T12:00:00Z"
    );
    const beforeFilter = await page.evaluate(() => (window as any).calls.length);
    await page.getByLabel("Task status", { exact: true }).selectOption("TODO");
    const tasks = page.getByRole("table", { name: "Tasks and milestones", exact: true });
    await expect(tasks.getByRole("row")).toHaveCount(2);
    await expect(tasks).not.toContainText("Record trial evidence");
    await page.getByLabel("Find task", { exact: true }).fill("no match");
    await expect(page.getByText("No tasks match these filters.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Clear task filters", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(tasks.getByRole("row")).toHaveCount(3);
    expect(await page.evaluate(() => (window as any).calls.length)).toBe(beforeFilter);
    expect(
      (await new AxeBuilder({ page }).analyze()).violations.filter((v) =>
        ["critical", "serious"].includes(v.impact ?? "")
      )
    ).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    await tasks.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "/tmp/nox-ui-v3/project-work-plan-" + width + ".png" });
    await page.evaluate(() => {
      (window as any).mode = "HOLD";
    });
    await page.getByRole("button", { name: "Refresh Operational Project", exact: true }).click();
    await page.evaluate(() => {
      (window as any).mode = "READY";
    });
    await page.getByLabel("Test tenant").selectOption("tenant-b");
    await expect(page.getByRole("heading", { name: "OPS-01 · Project tenant-b" })).toBeVisible();
    await page.evaluate(() => (window as any).releaseOld());
    await expect(page.getByRole("heading", { name: "OPS-01 · Project tenant-a" })).toHaveCount(0);
    await page.evaluate(() => (window as any).setRead(false));
    await expect(
      page.getByText("You do not have permission to read Operational Projects.")
    ).toBeVisible();
    const count = await page.evaluate(() => (window as any).calls.length);
    await page.getByLabel("Test tenant").selectOption("tenant-a");
    expect(await page.evaluate(() => (window as any).calls.length)).toBe(count);
    expect(
      await page.evaluate(() =>
        (window as any).calls.every((c: any) => c.tenantId && (!c.method || c.method === "GET"))
      )
    ).toBe(true);
    expect(errors).toEqual([]);
  });
}
