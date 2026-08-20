// Regenerate the member-guide PDF from the updated HTML using Chromium print-to-PDF.
// dezelfde A4 @page-geometrie als de originele PDF (size: A4; margin: 14mm).
import { chromium } from "@playwright/test";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const htmlPath = join(root, "public/member-guides/3sm-track-scanner-uitleg-members.html");
const outPath = join(root, "public/member-guides/3sm-track-scanner-uitleg-members.pdf");

// Playwright laadt chromium uit ~/.cache/ms-playwright; indien nodig expliciet via PW_CHROMIUM
const executable = process.env.PW_CHROMIUM;

(async () => {
  const browser = await chromium.launch(
    executable ? { executablePath: executable } : {}
  );
  const page = await browser.newPage();
  await page.goto("file://" + htmlPath, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  // print-to-pdf respecteert de @page { size: A4; margin: 14mm } uit de HTML.
  await page.pdf({ path: outPath, preferCSSPageSize: true, printBackground: true });
  await browser.close();
  console.log("PDF geschreven:", outPath);
})();