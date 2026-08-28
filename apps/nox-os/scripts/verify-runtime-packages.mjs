const requiredRuntimePackages = ["@nox-os/database", "@nox-os/platform", "@nox-os/scientific"];

await Promise.all(requiredRuntimePackages.map((packageName) => import(packageName)));

console.log(`RUNTIME_PACKAGE_IMPORT=PASS packages=${requiredRuntimePackages.length}`);
