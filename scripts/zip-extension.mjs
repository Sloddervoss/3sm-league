#!/usr/bin/env node
import { statSync } from "fs";
import { join, dirname } from "path";
import { execSync } from "child_process";

const __dirname = dirname(new URL(import.meta.url).pathname);
const root = join(__dirname, "..");
const extDir = join(root, "tools", "iracing-content-extension");
const outDir = join(root, "public");
const outFile = join(outDir, "iracing-content-extension.zip");

try {
  execSync(`mkdir -p "${outDir}"`, { stdio: "ignore" });
  execSync(`rm -f "${outFile}"`, { stdio: "ignore" });

  const py = `
import zipfile, os, sys
d = sys.argv[1]
out = sys.argv[2]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for f in os.listdir(d):
        z.write(os.path.join(d, f), f)
print(f"OK: {len(os.listdir(d))} files")
`;
  execSync(`python3 -c "${py.replace(/"/g, '\\"')}" "${extDir}" "${outFile}"`, {
    stdio: "inherit",
    shell: true,
  });

  const size = statSync(outFile).size;
  console.log(`Extension ZIP: ${(size / 1024).toFixed(1)} KB`);
} catch (error) {
  console.error("Extension ZIP failed:", error.message);
  process.exit(1);
}