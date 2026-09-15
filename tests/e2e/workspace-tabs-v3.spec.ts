import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const a = "11111111-1111-4111-8111-111111111111";
const b = "22222222-2222-4222-8222-222222222222";
async function mount(page: Page, path = `/materials/${a}`) {
  const result = await build({
    stdin: {
      loader: "tsx",
      resolveDir: resolve("packages/ui/src"),
      contents: `
    import {createRoot} from 'react-dom/client';
    import {useEffect,useMemo,useState} from 'react';
    import {NoxShell,NoxDialog,useWorkspaceObject,useUnsavedChanges} from './index';
    import './styles.css';
    const ids=${JSON.stringify([a, b])};
    const rail=[{moduleId:'material-intelligence',label:'Materials',routeRoot:'/materials',navigationGroup:'work',uxProfileId:'index'}];
    const resolveRoute=(type,id)=>type==='Material'&&ids.includes(id)?'/materials/'+id:undefined;
    function SecondDraft(){const [dirty,setDirty]=useState(false);useUnsavedChanges(dirty);return <label>Second unsaved edit<input type="checkbox" checked={dirty} onChange={e=>setDirty(e.target.checked)}/></label>;}
    function Body({route,tenant,go}){
      const id=route.split('/').at(-1);
      const [dirty,setDirty]=useState(false);
      const [second,setSecond]=useState(false);
      const [available,setAvailable]=useState(true);window.setObjectAvailable=setAvailable;
      useUnsavedChanges(dirty);
      const object=useMemo(()=>available&&ids.includes(id)?{id,objectType:'Material',title:tenant+' '+(id===ids[0]?'Alpha':'Beta'),route,properties:[{label:'Approval',value:'Approved'}]}:undefined,[id,tenant,route,available]);
      useWorkspaceObject(object);
      return <section><h1>{object?.title??'Material registry'}</h1><p>Offline UI fixture; no provider authentication.</p><button onClick={()=>go('/materials/'+ids[0])}>Open Alpha</button><button onClick={()=>go('/materials/'+ids[1])}>Open Beta</button><label>Unsaved edit<input type="checkbox" checked={dirty} onChange={e=>setDirty(e.target.checked)}/></label><button onClick={()=>setSecond(!second)}>Toggle second form</button>{second?<SecondDraft/>:null}</section>;
    }
    function App(){
      const [route,setRoute]=useState(location.pathname),[tenant,setTenant]=useState('Tenant A'),[dirty,setDirty]=useState(false),[pending,setPending]=useState();
      useEffect(()=>{const pop=()=>setRoute(location.pathname);window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);},[]);
      const requestChange=action=>dirty?setPending(()=>action):action();
      const navigate=next=>{history.pushState(null,'',next);setRoute(next);};
      return <NoxShell key={tenant} theme="DARK" density="DEFAULT" workspaceScope={{userId:'fixture-user',tenantId:tenant}} resolveObjectRoute={resolveRoute} activeRoute={route} railItems={rail} onNavigate={navigate} onUnsavedChange={setDirty} hasUnsavedChanges={dirty} requestWorkspaceChange={requestChange} tenantControl={<label>Current tenant<select value={tenant} onChange={e=>{const next=e.target.value;requestChange(()=>setTenant(next));}}><option>Tenant A</option><option>Tenant B</option></select></label>}>
        <Body key={tenant+route} route={route} tenant={tenant} go={next=>requestChange(()=>navigate(next))}/>
        {pending?<NoxDialog title="Unsaved changes" onClose={()=>setPending(undefined)}><button onClick={()=>setPending(undefined)}>Keep editing</button><button onClick={()=>{setDirty(false);pending();setPending(undefined);}}>Discard and continue</button></NoxDialog>:null}
      </NoxShell>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  `
    },
    bundle: true,
    write: false,
    outfile: "fixture.js",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }
  });
  await page.route("**/materials/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html lang="en"><head><title>NØX workspace fixture</title></head><body><div id="root"></div></body></html>'
    })
  );
  await page.goto(path);
  for (const output of result.outputFiles) {
    if (output.path.endsWith(".css")) await page.addStyleTag({ content: output.text });
    else await page.addScriptTag({ content: output.text });
  }
  await expect(page.getByRole("heading", { name: /Tenant A/, level: 1 })).toBeVisible();
}

test("active tab does not retain an unverified object title after its presentation is cleared", async ({
  page
}) => {
  await mount(page);
  await page.getByRole("button", { name: "Show inspector", exact: true }).click();
  await expect(page.getByRole("tab", { name: /Tenant A Alpha/ })).toBeVisible();
  await page.evaluate(() => (window as any).setObjectAvailable(false));
  await expect(page.getByRole("tab", { name: /Tenant A Alpha/ })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /Material.*Not loaded/ })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Contextual inspector" })).not.toContainText(
    "Approved"
  );
  await page.getByRole("button", { name: "Close inspector", exact: true }).click();
  await page.getByRole("button", { name: "Workspaces (1)", exact: true }).click();
  await expect(page.getByRole("region", { name: "Workspace switcher" })).not.toContainText(
    "Tenant A Alpha"
  );
  await page.evaluate(() => (window as any).setObjectAvailable(true));
  await expect(page.getByRole("tab", { name: /Tenant A Alpha/ })).toBeVisible();
});

test("multiple forms retain the workspace warning until every active draft is clean", async ({
  page
}) => {
  await mount(page);
  const unsavedTab = page.getByRole("tab", { name: /Unsaved/ });
  await page.getByLabel("Unsaved edit", { exact: true }).check();
  await expect(unsavedTab).toBeVisible();
  await page.getByRole("button", { name: "Toggle second form" }).click();
  await expect(unsavedTab).toBeVisible();
  await page.getByLabel("Second unsaved edit", { exact: true }).check();
  await page.getByLabel("Unsaved edit", { exact: true }).uncheck();
  await expect(unsavedTab).toBeVisible();
  await page.getByRole("button", { name: "Toggle second form" }).click();
  await expect(unsavedTab).toHaveCount(0);
  await page.getByLabel("Unsaved edit", { exact: true }).check();
  await page.getByRole("button", { name: "Toggle second form" }).click();
  await page.getByLabel("Second unsaved edit", { exact: true }).check();
  await page.getByRole("button", { name: "Toggle second form" }).click();
  await expect(unsavedTab).toBeVisible();
  await page.getByRole("button", { name: "Open Beta", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Unsaved changes" })).toBeVisible();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await page.getByLabel("Unsaved edit", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Open Beta", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tenant A Beta", exact: true })).toBeVisible();
  await expect(unsavedTab).toHaveCount(0);
});

test("object tabs dedupe, pin, restore metadata only, and follow browser history", async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mount(page);
  await page.getByRole("button", { name: "Pin current workspace", exact: true }).click();
  await page.getByRole("button", { name: "Open Beta", exact: true }).click();
  await expect(page.getByRole("tab", { name: /Beta/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Open Alpha", exact: true }).click();
  await expect(page.getByRole("button", { name: "Workspaces (2)", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("tab", { name: /Beta/ })).toHaveAttribute("aria-selected", "true");
  await page.goForward();
  await expect(page.getByRole("tab", { name: /Alpha/ })).toHaveAttribute("aria-selected", "true");
  const stored = await page.evaluate(() =>
    localStorage.getItem("nox:workspaces:v1:fixture-user:Tenant%20A")
  );
  expect(stored).not.toMatch(/Alpha|Beta|Approved|properties|title|route/);
  expect(JSON.parse(stored!).tabs).toEqual([
    { objectType: "Material", objectId: a, pinned: true },
    { objectType: "Material", objectId: b, pinned: false }
  ]);
  await mount(page);
  await expect(page.getByRole("button", { name: "Workspaces (2)", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Unpin current workspace", exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "Show inspector", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Contextual inspector" })).toContainText(
    "Tenant A Alpha"
  );
  await page.getByRole("button", { name: "Peek current context", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Peek current context" })).toContainText(
    "Tenant A Alpha"
  );
  await expect(page.getByRole("dialog", { name: "Peek current context" })).toContainText(
    "Approved"
  );
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Peek current context", exact: true })
  ).toBeFocused();
});

test("Inspector sizing, density and touch preferences restore without object data", async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mount(page);
  await page.getByRole("button", { name: "Show inspector", exact: true }).click();
  const size = page.getByRole("separator", { name: "Inspector width" });
  await size.focus();
  await page.keyboard.press("End");
  await expect(size).toHaveAttribute("aria-valuenow", "420");
  await page.keyboard.press("ArrowLeft");
  await expect(size).toHaveAttribute("aria-valuenow", "420");
  await page.keyboard.press("Home");
  await expect(size).toHaveAttribute("aria-valuenow", "280");
  await page.keyboard.press("ArrowLeft");
  await expect(size).toHaveAttribute("aria-valuenow", "290");
  const inspector = page.getByRole("complementary", { name: "Contextual inspector" });
  await inspector.getByRole("button", { name: "Properties", exact: true }).click();
  await expect(inspector.getByRole("region", { name: "Properties", exact: true })).toContainText(
    "Approved"
  );
  await page.getByRole("button", { name: "User menu", exact: true }).click();
  await page.getByLabel("Density", { exact: true }).selectOption("COMPACT");
  await page.getByLabel("Interaction mode", { exact: true }).selectOption("TOUCH");
  await page.keyboard.press("Escape");
  await expect(page.locator(".nox-os")).toHaveAttribute("data-density", "COMPACT");
  await expect(page.locator(".nox-os")).toHaveAttribute("data-interaction", "touch");
  const button = await page.getByRole("button", { name: "Open Beta", exact: true }).boundingBox();
  expect(button!.height).toBeGreaterThanOrEqual(44);
  const stored = await page.evaluate(() =>
    localStorage.getItem("nox:shell:v1:fixture-user:Tenant%20A")
  );
  expect(stored).not.toMatch(/Alpha|Approved|properties|permissions/);
  await mount(page);
  await expect(page.getByRole("separator", { name: "Inspector width" })).toHaveAttribute(
    "aria-valuenow",
    "290"
  );
  await expect(page.locator(".nox-os")).toHaveAttribute("data-interaction", "touch");
  await page.getByLabel("Current tenant").selectOption("Tenant B");
  await expect(page.getByRole("complementary", { name: "Contextual inspector" })).toBeHidden();
  await expect(page.locator(".nox-os")).toHaveAttribute("data-interaction", "auto");
});

test("closing dirty active tab is cancellable and tenant switching isolates metadata", async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mount(page);
  await page.getByRole("button", { name: "Open Beta", exact: true }).click();
  await page.getByLabel("Unsaved edit").check();
  await expect(page.getByRole("tab", { name: /Beta/ })).toContainText("●");
  await page.getByRole("button", { name: "Close current workspace", exact: true }).click();
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  await expect(page.getByLabel("Unsaved edit")).toBeChecked();
  await expect(page.getByRole("button", { name: "Workspaces (2)", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close current workspace", exact: true }).click();
  await page.getByRole("button", { name: "Discard and continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tenant A Alpha" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Workspaces (1)", exact: true })).toBeVisible();
  await page.getByLabel("Current tenant").selectOption("Tenant B");
  await expect(page.getByRole("heading", { name: "Tenant B Alpha" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Tenant A/ })).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("nox:workspaces:v1:fixture-user:Tenant%20B"))
  ).not.toContain(b);
});

for (const width of [1440, 390])
  test(`workspace switcher accessibility and viewport ${width}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await mount(page);
    await page.getByRole("button", { name: "Open Beta", exact: true }).click();
    await page.getByRole("button", { name: "Workspaces (2)", exact: true }).click();
    await expect(page.getByRole("region", { name: "Workspace switcher" })).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    mkdirSync("/tmp/nox-ui-v3", { recursive: true });
    await page.screenshot({ path: `/tmp/nox-ui-v3/workspaces-${width}.png` });
    await page
      .getByRole("region", { name: "Workspace switcher" })
      .getByRole("button", { name: /^Tenant A Alpha/ })
      .click();
    await expect(page.getByRole("heading", { name: "Tenant A Alpha" })).toBeVisible();
    expect(errors).toEqual([]);
  });
