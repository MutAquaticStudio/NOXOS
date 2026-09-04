const requiredRuntimePackages = [
  "@nox-os/database",
  "@nox-os/lab-services",
  "@nox-os/material-intelligence",
  "@nox-os/platform",
  "@nox-os/procurement",
  "@nox-os/release-readiness",
  "@nox-os/scientific"
];

await Promise.all(requiredRuntimePackages.map((packageName) => import(packageName)));

console.log(`RUNTIME_PACKAGE_IMPORT=PASS packages=${requiredRuntimePackages.length}`);
