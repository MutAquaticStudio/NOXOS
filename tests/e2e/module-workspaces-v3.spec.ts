import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const id = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const cases = [
  ["ReleaseAssessment", `/release-readiness/${id}`, "Assessment · REVIEW REQUIRED", "Policy"],
  ["MaterialLot", `/inventory/lots/${id}`, "LOT-01", "Available"],
  ["ProductionOrder", `/production/orders/${id}`, "PROD-01", "Target mass"],
  ["ProductionBatch", `/production/batches/${id}`, "BATCH-01", "Actual output"],
  ["QCSpecification", `/quality-control/specifications/${id}`, "SPEC-01 · v1", "Version"],
  [
    "QCInspection",
    `/quality-control/inspections/${id}`,
    "INSPECT-01",
    "QC outcome (not Batch Release)"
  ],
  ["Customer", `/lab-services/customers/${id}`, "Fixture Customer", "Code"],
  ["ServiceOrder", `/lab-services/service-orders/${id}`, "SERVICE-01", "Service lines"],
  ["OperationalProject", `/project-operations/projects/${id}`, "Fixture Project", "Service order"],
  ["CommercialQuote", `/commercial-orders/quotes/${id}`, "QUOTE-01 · Rev 1", "Currency"],
  ["CommercialOrder", `/commercial-orders/${id}`, "COMMERCIAL-01", "Fulfillment"]
] as const;

async function mount(
  page: Page,
  initialPath: string = cases[0][1],
  failOnce = false,
  actions = false
) {
  const result = await build({
    stdin: {
      loader: "tsx",
      resolveDir: resolve("apps/nox-os/src"),
      contents: `
        import {createRoot} from 'react-dom/client';
        import {useState} from 'react';
        import {BrowserRouter,Routes,Route,useLocation,useNavigate} from 'react-router-dom';
        import {NoxShell} from '@nox-os/ui';
        import '../../../packages/ui/src/styles.css';
        import {resolveWorkspaceObjectRoute} from './workspace-navigation';
        import {ReleaseReadinessExperience} from './release-readiness';
        import {InventoryExperience} from './inventory';
        import {ProductionExperience} from './production';
        import {QualityControlExperience} from './quality-control';
        import {LabServicesExperience} from './lab-services';
        import {ProjectOperationsExperience} from './project-operations';
        import {CommercialOrdersExperience} from './commercial-orders';
        const id=${JSON.stringify(id)}, tenantId=${JSON.stringify(tenantId)}, cases=${JSON.stringify(cases)};
        const modules=['release-readiness','inventory','production','quality-control','lab-services','project-operations','commercial-orders'];
        const rail=modules.map(moduleId=>({moduleId,routeRoot:'/'+moduleId,label:moduleId,navigationGroup:'work',uxProfileId:'index'}));
        const permissions=modules.map(m=>'module.'+m+'.read').concat('module.release-readiness.assessment.read','module.commercial-orders.order.read','module.commercial-orders.quote.read');
        const spec={id,tenantId,specificationCode:'SPEC-01',versionNumber:1,formulaVersionId:id,formulaBundleHash:'a'.repeat(64),status:'ACTIVE',items:[]};
        const inspection={id,tenantId,inspectionNumber:'INSPECT-01',batchId:id,specificationId:id,status:'FINAL',outcome:'PASS',results:[]};
        const order={id,orderNumber:'PROD-01',formulaVersionId:id,formulaBundleHash:'a'.repeat(64),targetMassMg:'120000',status:'DRAFT',lines:[],allocations:[]};
        const batch={id,batchNumber:'BATCH-01',productionOrderId:id,formulaVersionId:id,formulaBundleHash:'a'.repeat(64),targetMassMg:'120000',actualOutputMassMg:'119500',completedAt:'2026-09-05T00:00:00Z',abortedAt:null,allocations:[]};
        const payloads={
          '/commercial-orders':{orders:Array.from({length:26},(_,index)=>({id:index===0?id:'33333333-3333-4333-8333-'+String(index).padStart(12,'0'),order_number:'COMMERCIAL-'+String(index+1).padStart(2,'0'),customer_display_name_snapshot:index===0?'Exact Customer':'Fixture Customer',commercialAmountMinor:index===0?'900719925474099312345':null,currency_code:'USD',status:'DRAFT',allocationStatus:'NONE',fulfillmentStatus:'PARTIAL',shippingStatus:'NOT_STARTED',updated_at:'2026-09-05T00:00:00Z'}))},
          '/commercial-orders/quotes':{quotes:Array.from({length:26},(_,index)=>({id:index===0?id:'33333333-3333-4333-8333-'+String(index).padStart(12,'0'),quote_number:'QUOTE-'+String(index+1).padStart(2,'0'),revision_number:1,customer_display_name_snapshot:index===0?'Exact Customer':'Fixture Customer',commercialAmountMinor:index===0?'900719925474099312345':null,currency_code:'USD',status:'DRAFT',valid_until:null}))},
          ['/release-readiness/assessments/'+id]:{assessment:{id,formulaVersionId:id,formulaBundleHash:'a'.repeat(64),decision:'REVIEW_REQUIRED',policyKey:'fixture-policy',policyVersion:'1',checks:[],evidenceSnapshot:{approvalState:'APPROVED',approvalTrace:{verified:true}},releaseProfile:{applicationKey:'fine-fragrance',dosagePct:20}}},
          ['/inventory/lots/'+id]:{lot:{id,tenantId,lotCode:'LOT-01',materialId:id,materialDisplayName:'Fixture Material',materialApprovalStatus:'APPROVED',lifecycleStatus:'OPEN',availabilityStatus:'AVAILABLE',balances:[{locationId:id,onHandMg:'120000',reservedMg:'20000',availableMg:'100000'}]},movements:[],reservations:[]},
          '/inventory/locations':{locations:[]},
          ['/production/orders/'+id]:{order}, ['/production/batches/'+id]:{batch},
          ['/quality-control/specifications/'+id]:{specification:spec},
          ['/quality-control/inspections/'+id]:{inspection},
          ['/lab-services/customers/'+id]:{customer:{id,tenantId,displayName:'Fixture Customer',customerCode:'CUS-01',customerType:'COMPANY',status:'ACTIVE'},contacts:[],interactions:[],serviceOrders:[]},
          ['/lab-services/service-orders/'+id]:{serviceOrder:{id,tenantId,orderNumber:'SERVICE-01',customerDisplayName:'Fixture Customer',status:'CONFIRMED',lines:[]}},
          ['/project-operations/projects/'+id]:{project:{id,tenant_id:tenantId,name:'Fixture Project',project_code:'PROJECT-01',project_type:'INTERNAL',status:'ACTIVE'},tasks:[],phases:[],phaseState:[],dependencies:[],scope:[],links:[],updates:[]},
          ['/commercial-orders/quotes/'+id]:{quote:{id,quote_number:'QUOTE-01',revision_number:1,status:'DRAFT',currency_code:'USD',customer_id:id,customer_display_name_snapshot:'Fixture Customer'},lines:[]},
          ['/commercial-orders/orders/'+id]:{order:{id,order_number:'COMMERCIAL-01',status:'DRAFT',currency_code:'USD',customer_id:id,customer_display_name_snapshot:'Fixture Customer',fulfillmentStatus:'NOT_FULFILLED',shippingStatus:'NOT_SHIPPED'},lines:[
            {id:'physical',title_snapshot:'Fixture Material',line_kind:'MATERIAL',ordered_quantity:'120001',unit_price_minor:'900719925474099312345',price_basis_quantity:'1000000',discount_minor:null},
            {id:'service',title_snapshot:'Fixture Service',line_kind:'SERVICE_SCOPE',ordered_quantity:'1',unit_price_minor:'15000',price_basis_quantity:'1',discount_minor:'0'}
          ],allocations:[],fulfillments:[],shipments:[]}
        };
        if(${JSON.stringify(actions)}) {
          permissions.push(...['fulfillment.create','fulfillment.edit','fulfillment.confirm','fulfillment.cancel','shipment.create','shipment.ship','shipment.deliver','shipment.cancel'].map(p=>'module.commercial-orders.'+p));
          const commercial=payloads['/commercial-orders/orders/'+id];
          commercial.order.status='CONFIRMED';
          commercial.fulfillments=[{id:'44444444-4444-4444-8444-444444444444',fulfillment_number:'FUL-01',order_id:id,status:'DRAFT',updated_at:'2026-09-05T00:00:00Z'}];
          commercial.shipments=[{id:'66666666-6666-4666-8666-666666666666',shipment_number:'SHIP-01',status:'DRAFT',updated_at:'2026-09-05T00:00:00Z'}];
          commercial.allocations=[{id:'77777777-7777-4777-8777-777777777777',order_line_id:'physical',state:'ACTIVE',material_lot_id:id,quantity_value:'120001'},{id:'88888888-8888-4888-8888-888888888888',order_line_id:'service',state:'ACTIVE',material_lot_id:id,quantity_value:'1'}];
          payloads['/commercial-orders/fulfillments/44444444-4444-4444-8444-444444444444']={fulfillment:commercial.fulfillments[0],lines:[{order_line_id:'physical',allocation_id:'77777777-7777-4777-8777-777777777777',quantity_value:'120001'}]};
        }
        window.fixtureCalls=[];
        window.failOnce=${JSON.stringify(failOnce)};
        async function api(path,options={}) {
          window.fixtureCalls.push({path,method:options.method??'GET',tenantId:options.tenantId,body:options.body});
          if(options.method&&options.method!=='GET') {
            if(!${JSON.stringify(actions)})throw Error('Unexpected mutation');
            if(window.holdMutation)await new Promise(resolve=>window.releaseMutation=resolve);
            if(window.failMutation)throw Error('Current allocation is no longer available.');
            if(path.endsWith('/confirm'))payloads['/commercial-orders/orders/'+id].fulfillments[0].status='CONFIRMED';
            if(path.endsWith('/ship'))payloads['/commercial-orders/orders/'+id].shipments[0].status='SHIPPED';
            if(path.endsWith('/deliver'))payloads['/commercial-orders/orders/'+id].shipments[0].status='DELIVERED';
            return {};
          }
          if(options.tenantId!==tenantId) throw Error('Missing tenant');
          if(window.failOnce) {window.failOnce=false;throw Error('Temporary fixture outage');}
          if(window.denyReads) throw Error('Permission denied');
          if(!payloads[path]) throw Error('Unexpected API '+path);
          return structuredClone(payloads[path]);
        }
        const resolver=(type,id)=>resolveWorkspaceObjectRoute(rail,type,id);
        function App(){
          const location=useLocation(),navigate=useNavigate();
          const [grants,setGrants]=useState(permissions);window.fixtureGrants=setGrants;
          const props={api,tenantId,modulePermissions:grants};
          return <NoxShell theme="DARK" density="DEFAULT" activeRoute={location.pathname} onNavigate={navigate} railItems={rail} workspaceScope={{userId:'fixture-user',tenantId}} resolveObjectRoute={resolver}>
            <label>Fixture object<select value={location.pathname} onChange={e=>navigate(e.target.value)}>{cases.map(([type,path])=><option key={type} value={path}>{type}</option>)}</select></label>
            <p className="nox-ai-context">Offline UI fixture — no authenticated provider acceptance.</p>
            <Routes key={location.pathname}>
              <Route path="/release-readiness/*" element={<ReleaseReadinessExperience {...props}/>}/>
              <Route path="/inventory/*" element={<InventoryExperience {...props}/>}/>
              <Route path="/production/orders/:orderId" element={<ProductionExperience {...props}/>}/>
              <Route path="/production/batches/:batchId" element={<ProductionExperience {...props}/>}/>
              <Route path="/quality-control/*" element={<QualityControlExperience {...props}/>}/>
              <Route path="/lab-services/*" element={<LabServicesExperience {...props}/>}/>
              <Route path="/project-operations/*" element={<ProjectOperationsExperience {...props}/>}/>
              <Route path="/commercial-orders/*" element={<CommercialOrdersExperience {...props}/>}/>
            </Routes>
          </NoxShell>;
        }
        createRoot(document.getElementById('root')).render(<BrowserRouter><App/></BrowserRouter>);
      `
    },
    bundle: true,
    write: false,
    outfile: "fixture.js",
    jsx: "automatic",
    // Match the existing UI fixture boundary; cryptographic/domain work must never execute here.
    platform: "browser",
    define: { "process.env.NODE_ENV": '"production"' }
  });
  await page.route("**/*", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>NØX module workspace fixture</title></head><body><div id="root"></div></body></html>'
    })
  );
  await page.goto(initialPath);
  for (const output of result.outputFiles) {
    if (output.path.endsWith(".css")) await page.addStyleTag({ content: output.text });
    else await page.addScriptTag({ content: output.text });
  }
}

for (const width of [1440, 390])
  test(`commercial dialogs and exact-line draft safety ${width}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", () => errors.push("Unexpected native browser dialog"));
    await page.setViewportSize({ width, height: 900 });
    await mount(page, `/commercial-orders/${id}`, false, true);
    await page.getByRole("button", { name: "Set exact lines", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "Fulfillment lines", exact: true });
    await expect(editor.getByLabel("Quantity 1 (mg)", { exact: true })).toHaveValue("120001");
    await expect(editor.getByLabel("Active allocation 1").locator("option")).toHaveCount(2);
    await editor.getByLabel("Order line 1").selectOption("service");
    await expect(editor.getByLabel("Quantity 1 (service)")).toHaveValue("1");
    await expect(editor.getByLabel("Active allocation 1")).toHaveCount(0);
    await expect(
      editor.getByRole("button", { name: "Save exact lines — blocked", exact: true })
    ).toBeDisabled();
    expect((await new AxeBuilder({ page }).include("dialog").analyze()).violations).toEqual([]);
    await page.screenshot({ path: `/tmp/nox-ui-v3/fulfillment-lines-${width}.png` });
    await page.keyboard.press("Escape");
    await editor.getByRole("button", { name: "Keep editing", exact: true }).click();
    await expect(editor.getByLabel("Quantity 1 (service)")).toHaveValue("1");
    await editor.getByRole("button", { name: "Back to Order", exact: true }).click();
    await editor.getByRole("button", { name: "Discard changes", exact: true }).click();
    const mutations = () =>
      page.evaluate(() =>
        (window as any).fixtureCalls.filter((call: any) => call.method !== "GET")
      );
    expect(await mutations()).toEqual([]);
    const trigger = page.getByRole("button", { name: "Confirm & consume", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Confirm & consume", exact: true });
    await expect(dialog).toContainText("FUL-01");
    await expect(dialog).toContainText("consume their active physical allocations atomically");
    await dialog.getByRole("button", { name: "Back without changes", exact: true }).click();
    await expect(trigger).toBeFocused();
    expect(await mutations()).toEqual([]);
    await trigger.click();
    await page.evaluate(() => {
      (window as any).holdMutation = true;
      (window as any).failMutation = true;
    });
    await dialog.getByRole("button", { name: "Confirm Confirm & consume", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Submitting…", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    expect(await mutations()).toHaveLength(1);
    await page.evaluate(() => (window as any).releaseMutation());
    await expect(dialog.getByRole("alert")).toContainText(
      "Current allocation is no longer available"
    );
    await expect(
      dialog.getByRole("button", { name: "Confirm Confirm & consume", exact: true })
    ).toBeDisabled();
    expect((await new AxeBuilder({ page }).include("dialog").analyze()).violations).toEqual([]);
    await page.screenshot({ path: `/tmp/nox-ui-v3/fulfillment-error-${width}.png` });
    await dialog.getByRole("button", { name: "Back without changes", exact: true }).click();
    await page.getByRole("button", { name: "Cancel Fulfillment", exact: true }).click();
    const cancel = page.getByRole("dialog", { name: "Cancel Fulfillment", exact: true });
    await expect(
      cancel.getByRole("button", { name: "Confirm Cancel Fulfillment", exact: true })
    ).toBeDisabled();
    await cancel.getByLabel("Cancellation reason").fill("Changed schedule");
    await expect(
      cancel.getByRole("button", { name: "Confirm Cancel Fulfillment", exact: true })
    ).toBeEnabled();
    await page.evaluate(() => (window as any).fixtureGrants([]));
    await expect(cancel).toHaveCount(0);
    expect(await mutations()).toHaveLength(1);
    expect(errors).toEqual([]);
  });

for (const width of [1440, 390])
  test(`commercial registries preserve precision, paginate, filter and recover ${width}`, async ({
    page
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await mount(page, "/commercial-orders", true);
    await expect(page.getByRole("alert")).toContainText("Commercial Orders could not be loaded");
    await expect(
      page.getByText("No Commercial Orders match these filters.", { exact: true })
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Retry Orders", exact: true }).click();
    for (const kind of ["Orders", "Quotes"]) {
      if (kind === "Quotes") await page.getByRole("link", { name: "Quotes", exact: true }).click();
      const name = kind === "Orders" ? "Commercial Orders" : "Quotes";
      const table = page.getByRole("table", { name, exact: true });
      await expect(table.locator("tbody tr")).toHaveCount(25);
      await expect(table).toContainText("900719925474099312345 USD minor units");
      await expect(table.locator("tbody tr").nth(1).locator("td.nox-numeric")).toHaveText("—");
      await page.getByLabel("Customer", { exact: true }).fill("Exact Customer");
      await expect(table.locator("tbody tr")).toHaveCount(1);
      await page.getByLabel("Customer", { exact: true }).fill("No matching customer");
      await expect(
        page.getByText(`No ${name} match these filters.`, { exact: true })
      ).toBeVisible();
      await page.getByRole("button", { name: "Clear filters", exact: true }).click();
      await page.getByRole("button", { name: "Next page", exact: true }).click();
      await expect(table.locator("tbody tr")).toHaveCount(1);
      await expect(page.getByRole("navigation", { name: "Registry pagination" })).toContainText(
        "26–26 of 26"
      );
      await page
        .getByRole("button", { name: kind === "Orders" ? "Order ↑" : "Quote ↑", exact: true })
        .click();
      await expect(table.locator("tbody tr")).toHaveCount(25);
      await expect(table.locator("tbody tr").first()).toContainText(
        kind === "Orders" ? "COMMERCIAL-26" : "QUOTE-26"
      );
      const scroll = page.getByRole("region", { name: `${name} scroll area`, exact: true });
      const callsBeforeColumns = await page.evaluate(() => (window as any).fixtureCalls.length);
      await page.locator(".nox-commercial-columns summary").click();
      const columnManager = page.getByRole("group", { name: `${name} columns`, exact: true });
      const identity = kind === "Orders" ? "Order" : "Quote";
      await expect(
        columnManager.getByRole("checkbox", { name: `Show ${identity} (identity)`, exact: true })
      ).toBeDisabled();
      await columnManager.getByRole("checkbox", { name: "Show Customer", exact: true }).uncheck();
      await expect(table.getByRole("columnheader", { name: "Customer", exact: true })).toHaveCount(
        0
      );
      await expect(
        columnManager.getByRole("combobox", { name: "Width for Customer", exact: true })
      ).toBeDisabled();
      await columnManager
        .getByRole("combobox", { name: `Width for ${identity}`, exact: true })
        .selectOption("240");
      expect(
        await table
          .locator("tbody tr")
          .first()
          .locator("td")
          .first()
          .evaluate((cell) => getComputedStyle(cell).minWidth)
      ).toBe("240px");
      expect(
        (await new AxeBuilder({ page }).include(".nox-commercial-columns").analyze()).violations
      ).toEqual([]);
      if (kind === "Quotes") {
        await page.locator(".nox-commercial-columns").scrollIntoViewIfNeeded();
        mkdirSync("/tmp/nox-ui-v3", { recursive: true });
        await page.screenshot({ path: `/tmp/nox-ui-v3/commercial-columns-${width}.png` });
      }
      await page.locator(".nox-commercial-columns summary").click();
      await scroll.focus();
      await expect(scroll).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(table.locator("tbody tr").first().getByRole("link")).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(table.locator("tbody tr").nth(1).getByRole("link")).toBeFocused();
      await page.keyboard.press("ArrowRight");
      // Hidden customer cells are skipped; headers and body stay aligned.
      const nextIndex = kind === "Orders" ? 2 : 1;
      await expect(table.locator("tbody tr").nth(1).locator("td").nth(nextIndex)).toBeFocused();
      await page.keyboard.press("End");
      await expect(table.locator("tbody tr").nth(1).locator("td").last()).toBeFocused();
      await page.keyboard.press("Home");
      await expect(table.locator("tbody tr").nth(1).getByRole("link")).toBeFocused();
      await page.locator(".nox-commercial-columns summary").click();
      await columnManager.getByRole("button", { name: "Reset columns", exact: true }).click();
      await expect(table.getByRole("columnheader", { name: "Customer", exact: true })).toHaveCount(
        1
      );
      await expect(
        columnManager.getByRole("combobox", { name: `Width for ${identity}`, exact: true })
      ).toHaveValue("0");
      await page.locator(".nox-commercial-columns summary").click();
      expect(await page.evaluate(() => (window as any).fixtureCalls.length)).toBe(
        callsBeforeColumns
      );
      expect(
        await table
          .locator("tbody tr")
          .first()
          .locator("td.nox-numeric")
          .evaluate((e) => getComputedStyle(e).textAlign)
      ).toBe("right");
      expect(
        await table
          .locator("tbody tr")
          .first()
          .locator("td")
          .first()
          .evaluate((e) => getComputedStyle(e).position)
      ).toBe("sticky");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true
      );
      expect(
        (await new AxeBuilder({ page }).include(".nox-commercial-workspace").analyze()).violations
      ).toEqual([]);
      await page.locator("#nox-workspace-panel").evaluate((e) => (e.scrollTop = 0));
      mkdirSync("/tmp/nox-ui-v3", { recursive: true });
      await page.screenshot({
        path: `/tmp/nox-ui-v3/commercial-${kind.toLowerCase()}-${width}.png`
      });
    }
    expect(errors).toEqual([]);
  });

for (const width of [1440, 390])
  test(`existing module details publish scoped Inspector and restorable tabs ${width}`, async ({
    page
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await mount(page);
    await expect(page).toHaveTitle("NØX module workspace fixture");
    for (const [index, [, path, title, property]] of cases.entries()) {
      await page.getByLabel("Fixture object").selectOption(path);
      await expect(
        page.getByRole("button", { name: `Workspaces (${index + 1})`, exact: true })
      ).toBeVisible();
      if (index === cases.length - 1) {
        const lines = page.getByRole("table", { name: "Commercial lines", exact: true });
        await expect(lines).toContainText("120001 mg");
        await expect(lines).toContainText("900719925474099312345 USD minor units / 1000000 mg");
        await expect(lines).toContainText("15000 USD minor units / 1 service");
        await expect(lines.locator("tbody tr").first().locator("td").last()).toHaveText("—");
        await expect(lines.locator("tbody tr").last().locator("td").last()).toHaveText(
          "0 USD minor units"
        );
      }
      await page.getByRole("button", { name: "Show inspector", exact: true }).click();
      const inspector = page.getByRole("complementary", { name: "Contextual inspector" });
      await expect(inspector).toContainText(title);
      await inspector.getByRole("button", { name: "Properties", exact: true }).click();
      await expect(inspector).toContainText(property);
      await expect(inspector).not.toContainText("undefined");
      if (index === cases.length - 1) {
        expect(
          (await new AxeBuilder({ page }).include(".nox-inspector").analyze()).violations
        ).toEqual([]);
        mkdirSync("/tmp/nox-ui-v3", { recursive: true });
        await page.screenshot({ path: `/tmp/nox-ui-v3/module-inspector-${width}.png` });
      }
      await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    }
    // The Inspector consumes existing detail DTOs: no new fetches or mutations.
    expect(await page.evaluate(() => (window as any).fixtureCalls.length)).toBe(13);
    await page.getByLabel("Fixture object").selectOption(cases[0][1]);
    await expect(page.getByRole("button", { name: "Workspaces (11)", exact: true })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(cases.at(-1)![1] + "$"));
    const stored = await page.evaluate(() =>
      Object.entries(localStorage)
        .filter(([k]) => k.startsWith("nox:workspaces:"))
        .map(([, v]) => JSON.parse(v))
    );
    expect(stored[0].tabs.map((tab: { objectType: string }) => tab.objectType)).toEqual(
      cases.map(([type]) => type)
    );
    expect(JSON.stringify(stored)).not.toMatch(
      /Fixture Customer|COMMERCIAL-01|formulaBundleHash|properties|fulfillmentStatus/
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    expect(
      await page.evaluate(
        (tenant) =>
          (window as any).fixtureCalls.every(
            (c: any) => c.method === "GET" && c.tenantId === tenant
          ),
        tenantId
      )
    ).toBe(true);
    await page.evaluate(() => {
      (window as any).denyReads = true;
    });
    await page.getByLabel("Fixture object").selectOption(cases[0][1]);
    await expect(page.getByRole("alert")).toContainText("Permission denied");
    await page.getByRole("button", { name: "Show inspector", exact: true }).click();
    const deniedInspector = page.getByRole("complementary", { name: "Contextual inspector" });
    await expect(deniedInspector).not.toContainText("Fixture Customer");
    await expect(deniedInspector).not.toContainText("fixture-policy");
    await expect(
      deniedInspector.getByRole("button", { name: "Properties", exact: true })
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Workspaces (11)", exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
