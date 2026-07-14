#!/usr/bin/env node
import { mkdirSync, rmSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const extDir = join(root, "tools", "iracing-content-extension");
const outDir = join(root, "public");
const outFile = join(outDir, "iracing-content-extension.zip");

try {
  mkdirSync(outDir, { recursive: true });
  rmSync(outFile, { force: true });

  const py = `
import os, sys, zipfile
source_dir = sys.argv[1]
out_file = sys.argv[2]
files = sorted(name for name in os.listdir(source_dir) if os.path.isfile(os.path.join(source_dir, name)))
with zipfile.ZipFile(out_file, "w") as archive:
    for name in files:
        info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.create_system = 3
        info.external_attr = (0o100644 & 0xFFFF) << 16
        with open(os.path.join(source_dir, name), "rb") as source:
            archive.writestr(info, source.read())
print(f"OK: {len(files)} files")
`;
  execFileSync("python3", ["-c", py, extDir, outFile], { stdio: "inherit" });

  const size = statSync(outFile).size;
  console.log(`Extension ZIP: ${(size / 1024).toFixed(1)} KB`);
} catch (error) {
  console.error("Extension ZIP failed:", error.message);
  process.exit(1);
}