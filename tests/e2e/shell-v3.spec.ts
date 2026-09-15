import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Component fixture only: never shipped as a route or an authentication bypass.
async function mountShell(page: Page) {
  const result = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';
        import {useState} from 'react';
        import {NoxShell} from './index';
        import './styles.css';
        const items = ['Materials','Design Studio','Trials','Inventory','Procurement','Production','Commercial Orders'].map((label,i)=>({moduleId:String(i),label,routeRoot:'/module-'+i,navigationGroup:'work',uxProfileId:'index'}));
        function Fixture(){const [route,setRoute]=useState('/module-0');const [theme,setTheme]=useState('DARK');return <NoxShell theme={theme} onThemeChange={setTheme} density="DEFAULT" railItems={items} activeRoute={route} onNavigate={setRoute} identityLabel="UI fixture" tenantControl={<label>Tenant<select aria-label="Current tenant"><option>Test workspace</option></select></label>}><h1>{items.find(x=>x.routeRoot===route)?.label}</h1><p>Isolated presentation fixture. No backend connection.</p><div className="nox-table-wrap" tabIndex={0}><table><thead><tr><th scope="col">Material</th><th scope="col">Type</th><th scope="col">Status</th></tr></thead><tbody><tr><td>Fixture material</td><td>Mixture</td><td>Pending review</td></tr></tbody></table></div><button className="nox-material-primary-action">Read-only fixture action</button></NoxShell>}
        createRoot(document.getElementById('root')).render(<Fixture/>);`,
      resolveDir: resolve("packages/ui/src"),
      loader: "tsx"
    },
    bundle: true,
    write: false,
    outfile: "fixture.js",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' }
  });
  await page.setContent(
    '<!doctype html><html lang="en"><head><title>NØX Shell UI fixture</title></head><body><div id="root"></div></body></html>'
  );
  await page.addStyleTag({
    content: result.outputFiles.find((file) => file.path.endsWith(".css"))!.text
  });
  await page.addScriptTag({
    content: result.outputFiles.find((file) => file.path.endsWith(".js"))!.text
  });
  await expect(page.getByRole("heading", { name: "Materials", exact: true })).toBeVisible();
}

for (const width of [1440, 1024, 768, 390, 320]) {
  test(`shell v3: ${width}px navigation, focus, theme and overflow`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await mountShell(page);
    mkdirSync("/tmp/nox-ui-v3", { recursive: true });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(
      await page
        .locator(".nox-material-primary-action")
        .evaluate((node) => getComputedStyle(node).color)
    ).toBe("rgb(7, 8, 12)");
    await page.screenshot({ path: `/tmp/nox-ui-v3/shell-dark-${width}.png` });
    await expect(page.getByLabel("Current tenant")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    if (width < 768)
      await page.getByRole("button", { name: "Application menu", exact: true }).click();
    await page.getByRole("button", { name: "Commercial Orders", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Commercial Orders", exact: true })
    ).toBeVisible();
    await page.keyboard.press("Control+k");
    const command = page.getByRole("dialog", { name: "Command Center", exact: true });
    await expect(command).toBeVisible();
    await command.getByRole("button", { name: "Close Command Center" }).focus();
    await page.keyboard.press("Shift+Tab");
    expect(await command.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    await command.getByLabel("Search commands").fill("Design");
    await expect(command.getByRole("button", { name: "Materials", exact: true })).toHaveCount(0);
    await command.getByRole("button", { name: "Design Studio", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Design Studio", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "User menu", exact: true }).click();
    await page.getByLabel("Theme", { exact: true }).selectOption("LIGHT");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "User menu", exact: true })).toBeFocused();
    expect(
      await page.locator(".nox-os").evaluate((node) => getComputedStyle(node).backgroundColor)
    ).toBe("rgb(243, 244, 248)");
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
    expect(errors).toEqual([]);
    mkdirSync("/tmp/nox-ui-v3", { recursive: true });
    await page.screenshot({ path: `/tmp/nox-ui-v3/shell-${width}.png` });
  });
}
