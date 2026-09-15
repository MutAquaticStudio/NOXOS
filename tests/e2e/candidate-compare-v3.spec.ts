import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const { width, readOnly } of [
  { width: 1440, readOnly: true },
  { width: 390, readOnly: true },
  { width: 390, readOnly: false }
])
  test(`Candidate source comparison and ${readOnly ? "read-only history" : "guarded Freeze"} at ${width}px`, async ({
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
    import {useState} from 'react';
    import {FormulaCandidates} from './design-studio';
    import {NoxShell} from '@nox-os/ui';
    import '../../../packages/ui/src/styles.css';
    const candidates=['FAITHFUL','EXPRESSIVE','MINIMALIST'].map((strategy,index)=>({
      candidateId:'candidate-'+index,compositionKind:'FULL_FORMULA',generationStrategy:strategy,engineVersion:'fixture-engine-v1',taxonomyVersion:'osmo_v1.2',
      lines:[{materialId:'material-'+index,normalizedMassMg:'1000000',activeAromaticMassMg:'1000000',carrierSolventMassMg:'0',contributionEvidence:[],materialSnapshot:{material:{displayName:'Fixture Material '+index,materialType:'SINGLE_MOLECULE',approvalStatus:'APPROVED',noteClassification:'MID'},identifiers:{},odorAssignments:[]}}],
      validation:{structuralValidation:'PASS',materialEligibility:'PASS',knownLimitScreening:'REVIEW_REQUIRED',unresolvedConstraints:index===1?['Evidence needs review']:[],warnings:[],releaseReadiness:'NOT_ASSESSED'},scientificContext:{capability:'CURATED_ONLY'}
    }));
    window.freezeCalls=0;
    function Fixture(){const [selected,setSelected]=useState(0),[canFreeze,setCanFreeze]=useState(true);window.setFreezePermission=setCanFreeze;return <NoxShell theme="DARK" density="DEFAULT" activeRoute="/design-studio" railItems={[]} onNavigate={()=>{}}><h1>Candidate comparison UI fixture</h1><p>Offline presentation only; no provider authentication or domain acceptance.</p><FormulaCandidates candidates={candidates} selected={selected} onSelect={setSelected} onFreeze={()=>{if(${readOnly})throw Error('History cannot freeze');window.freezeCalls++;return new Promise(resolve=>window.finishFreeze=resolve)}} canFreeze={canFreeze} readOnly={${readOnly}}/></NoxShell>}
    createRoot(document.getElementById('root')).render(<Fixture/>);
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
    await page.setContent(
      '<!doctype html><html lang="en"><head><title>Candidate UI fixture</title></head><body><div id="root"></div></body></html>'
    );
    for (const output of result.outputFiles) {
      if (output.path.endsWith(".css")) await page.addStyleTag({ content: output.text });
      else await page.addScriptTag({ content: output.text });
    }
    if (width < 600) {
      await expect(page.getByRole("button", { name: "Next direction" })).toBeVisible();
      await page.getByRole("checkbox", { name: "Show composition differences" }).check();
      await page.getByRole("button", { name: "Next direction" }).click();
      await expect(
        page.getByRole("checkbox", { name: "Show composition differences" })
      ).toBeChecked();
      await expect(page.getByRole("region", { name: "Composition differences" })).toContainText(
        "Added"
      );
    }
    const comparison = page.getByRole("region", { name: "Candidate comparison", exact: true });
    await expect(comparison.getByRole("columnheader")).toHaveCount(width < 600 ? 2 : 4);
    if (width >= 600) await expect(comparison).toContainText("Evidence needs review");
    await expect(comparison).toContainText("fixture-engine-v1");
    await page.getByRole("tab", { name: "EXPRESSIVE", exact: true }).click();
    await expect(
      page
        .getByRole("tabpanel", { name: "EXPRESSIVE", exact: true })
        .getByText("Fixture Material 1", { exact: true })
    ).toBeVisible();
    await page.getByRole("tab", { name: "EXPRESSIVE", exact: true }).press("ArrowRight");
    await expect(page.getByRole("tab", { name: "MINIMALIST", exact: true })).toBeFocused();
    if (width < 600) {
      await expect(page.getByRole("button", { name: "Next direction" })).toBeDisabled();
      await page.getByRole("button", { name: "Previous direction" }).click();
      await expect(
        page.getByRole("checkbox", { name: "Show composition differences" })
      ).toBeChecked();
      await page.getByRole("combobox", { name: "Compare against" }).selectOption("candidate-1");
      await expect(page.getByText("No composition differences.", { exact: true })).toBeVisible();
      await page.getByRole("combobox", { name: "Compare against" }).selectOption("candidate-0");
    }
    if (readOnly) {
      await expect(page.getByRole("button", { name: "Use This Formula", exact: true })).toHaveCount(
        0
      );
      await expect(page.getByText(/cannot be frozen from this history view/)).toBeVisible();
    } else {
      const useFormula = page.getByRole("button", { name: "Use This Formula", exact: true });
      await useFormula.click();
      const dialog = page.getByRole("dialog", { name: "Freeze exact Formula" });
      await expect(dialog).toContainText("1 kg");
      await expect(dialog).toContainText("candidate-1");
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      mkdirSync("/tmp/nox-ui-v3", { recursive: true });
      await page.screenshot({ path: "/tmp/nox-ui-v3/candidate-freeze-confirmation-390.png" });
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(useFormula).toBeFocused();
      expect(
        await page.evaluate(() => (window as Window & { freezeCalls?: number }).freezeCalls)
      ).toBe(0);
      await useFormula.click();
      await page.evaluate(() =>
        (
          window as Window & { setFreezePermission?: (value: boolean) => void }
        ).setFreezePermission?.(false)
      );
      await expect(
        dialog.getByRole("button", { name: "Confirm Freeze", exact: true })
      ).toBeDisabled();
      await expect(dialog.getByRole("alert")).toContainText("availability changed");
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await page.evaluate(() =>
        (
          window as Window & { setFreezePermission?: (value: boolean) => void }
        ).setFreezePermission?.(true)
      );
      await useFormula.click();
      await dialog.getByRole("button", { name: "Confirm Freeze", exact: true }).click();
      await expect(dialog.getByRole("button", { name: "Freezing…", exact: true })).toBeDisabled();
      expect(
        await page.evaluate(() => (window as Window & { freezeCalls?: number }).freezeCalls)
      ).toBe(1);
      await page.evaluate(() =>
        (window as Window & { finishFreeze?: (value: boolean) => void }).finishFreeze?.(false)
      );
      await expect(dialog.getByRole("alert")).toContainText("not confirmed by the server");
      await dialog.getByRole("button", { name: "Confirm Freeze", exact: true }).click();
      await page.evaluate(() =>
        (window as Window & { finishFreeze?: (value: boolean) => void }).finishFreeze?.(true)
      );
      await expect(dialog).toHaveCount(0);
      expect(
        await page.evaluate(() => (window as Window & { freezeCalls?: number }).freezeCalls)
      ).toBe(2);
    }
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
    expect(errors).toEqual([]);
    mkdirSync("/tmp/nox-ui-v3", { recursive: true });
    await page.screenshot({
      path: `/tmp/nox-ui-v3/candidate-${readOnly ? "compare" : "freeze"}-${width}.png`
    });
  });
