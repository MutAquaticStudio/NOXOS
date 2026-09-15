import { build } from "esbuild";
import { resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";

for (const width of [1280, 320]) {
  test(`Release commands retain retry identity at ${width}px`, async ({ page }) => {
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
          import {BrowserRouter} from 'react-router-dom';
          import {NoxShell} from '@nox-os/ui';
          import '../../../packages/ui/src/styles.css';
          import {ReleaseReadinessExperience} from './release-readiness';
          import {releaseReadinessPermissions} from '../../../packages/release-readiness/src/authorization';
          window.posts=[]; const attempts={};
          const first='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
          const second='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
          function assessment(id){return {id,formulaVersionId:first,formulaBundleHash:'immutable-hash',
            policyKey:'g6-known-limit-v1',policyVersion:'1',decision:'READY',checks:[],
            assessedAt:'2026-09-08T00:00:00Z',supersedesAssessmentId:null,
            releaseProfile:{applicationKey:'fine-fragrance',dosagePct:20},
            evidenceSnapshot:{approvalState:'APPROVED',approvalTrace:{verified:true}}};}
          async function api(path,options={}){
            if(options.method==='POST'){
              window.posts.push({path,...options}); attempts[path]=(attempts[path]||0)+1;
              if(attempts[path]===1)throw Error('Private SQL diagnostic must not render');
              return {assessment:assessment(path.endsWith('/reassess')?second:first)};
            }
            return {assessment:assessment(path.split('/').pop())};
          }
          createRoot(document.getElementById('root')).render(<BrowserRouter>
            <NoxShell theme="DARK" density="DEFAULT" activeRoute="/release-readiness" railItems={[]} onNavigate={()=>{}} onUnsavedChange={dirty=>window.dirty=dirty}>
              <ReleaseReadinessExperience api={api} tenantId="tenant-a" modulePermissions={Object.values(releaseReadinessPermissions)}/>
            </NoxShell></BrowserRouter>);
        `
      },
      bundle: true,
      write: false,
      outfile: "release-command.js",
      platform: "browser",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' }
    });
    await page.route("**/*", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>NØX Release commands</title></head><body><div id="root"></div></body></html>'
      })
    );
    await page.goto("/release-readiness/new");
    for (const output of bundle.outputFiles)
      if (output.path.endsWith(".css")) await page.addStyleTag({ content: output.text });
      else await page.addScriptTag({ content: output.text });
    await expect(page).toHaveTitle("NØX Release commands");
    await page.getByLabel("Approved FormulaVersion").fill("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    await expect.poll(() => page.evaluate(() => (window as any).dirty)).toBe(true);
    await page.getByRole("button", { name: "← Assessments" }).click();
    await expect(page.getByRole("dialog", { name: "Leave assessment form?" })).toBeVisible();
    await page.getByRole("button", { name: "Keep editing" }).click();
    await expect(page.getByLabel("Approved FormulaVersion")).toHaveValue(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    );
    await page.getByRole("button", { name: "Run Assessment" }).click();
    await expect(page.getByRole("alert")).toContainText("response could not be confirmed");
    await expect(page.locator("body")).not.toContainText("Private SQL");
    await expect(page.getByLabel("Approved FormulaVersion")).toBeDisabled();
    await expect(page.getByLabel("Dosage %")).toBeDisabled();
    await expect(page.getByLabel("Application", { exact: true })).toBeDisabled();
    await expect(page.getByRole("status").filter({ hasText: "profile is locked" })).toBeVisible();
    await page.getByRole("button", { name: "Run Assessment" }).click();
    await expect(page).toHaveURL(/\/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa$/);
    await expect.poll(() => page.evaluate(() => (window as any).dirty)).toBe(false);
    await page.getByRole("button", { name: "Reassess Current Evidence" }).click();
    await expect(page.getByRole("alert")).toContainText("No new request key");
    await expect(page.getByRole("heading", { name: "READY", exact: true })).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "No check evidence" })).toContainText(
      "No check evidence was returned"
    );
    await expect(page.locator("body")).not.toContainText("Private SQL");
    mkdirSync("/tmp/nox-ui-v3", { recursive: true });
    await page.screenshot({ path: `/tmp/nox-ui-v3/release-retry-${width}.png` });
    await page.getByRole("button", { name: "Retry same reassessment request" }).click();
    await expect(page).toHaveURL(/\/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb$/);
    const posts = await page.evaluate(() => (window as any).posts);
    expect(posts).toHaveLength(4);
    expect(posts[0].body).toEqual(posts[1].body);
    expect(posts[2].body).toEqual(posts[3].body);
    expect(posts[0].body.idempotencyKey).not.toBe(posts[2].body.idempotencyKey);
    for (const post of posts) {
      expect(post.tenantId).toBe("tenant-a");
      expect(post.body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    }
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
