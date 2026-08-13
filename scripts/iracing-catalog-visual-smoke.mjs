import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const artifacts = path.join(root, "artifacts", "visual-smoke", "iracing-catalog");
const envSource = process.env.SMOKE_ENV_FILE || path.join(root, ".env.production.local");
const fallbackEnv = "/home/hermes/projects/3sm-league/.env.production.local";
const selectedEnv = existsSync(envSource) ? envSource : fallbackEnv;
const port = Number(process.env.SMOKE_PORT || 4187);
const baseURL = `http://127.0.0.1:${port}`;

const parseEnv = async (file) => Object.fromEntries((await readFile(file, "utf8")).split(/\r?\n/)
  .filter((line) => line && !line.trimStart().startsWith("#") && line.includes("="))
  .map((line) => { const at = line.indexOf("="); return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^(['"])(.*)\1$/, "$2")]; }));

if (!existsSync(selectedEnv)) throw new Error("No client-safe Vite env found. Set SMOKE_ENV_FILE.");
const clientEnv = await parseEnv(selectedEnv);
for (const key of ["VITE_SUPABASE_URL", "VITE_SUPABASE_ANON_KEY"]) {
  if (!clientEnv[key]) throw new Error(`${key} is missing from ${selectedEnv}`);
}
const supabaseProjectRef = new URL(clientEnv.VITE_SUPABASE_URL).hostname.split(".")[0];
const authStorageKey = `sb-${supabaseProjectRef}-auth-token`;

const events = [{
  id: "event-portimao", source_key: "iracing:2026:portimao-1000", name: "Portimão 1000", year: 2026,
  circuit: "Algarve International Circuit", configuration: "Grand Prix", event_start_date: "2026-08-14", event_end_date: "2026-08-15",
  duration_minutes: null, class_ids: ["HPD", "GT1", "GT2"], local_class_ids: ["GTP", "LMP2", "GT3"],
  local_car_ids: ["hpd-arx-01c"], cars: [{ sourceKey: "hpd", name: "HPD ARX-01c", imageUrl: null, officialClassId: "HPD" }],
  team_event: true, official_url: "https://www.iracing.com/special-events/", poster_url: null, availability_status: "exact_slots",
  source_updated_at: null, last_seen_at: "2026-08-13T08:00:00Z", active: true,
}, {
  id: "event-southern", source_key: "iracing:2026:southern-500", name: "Southern 500", year: 2026,
  circuit: "Darlington Raceway", configuration: null, event_start_date: "2026-09-02", event_end_date: "2026-09-07",
  duration_minutes: null, class_ids: ["NASCAR CUP SERIES"], local_class_ids: [], local_car_ids: [], cars: [], team_event: false,
  official_url: "https://www.iracing.com/special-events/", poster_url: null, availability_status: "date_only",
  source_updated_at: null, last_seen_at: "2026-08-13T08:00:00Z", active: true,
}];
const slots = ["00:00", "09:00", "14:00", "18:00", "22:00"].map((label, index) => ({
  id: `slot-${index}`, catalog_event_id: "event-portimao", source_slot_key: `slot-${index}`,
  session_start_at: `2026-08-15T${label}:00Z`, practice_start_at: null, practice_duration_minutes: 30,
  qualifying_start_at: null, qualifying_duration_minutes: 8, transition_duration_minutes: null,
  estimated_race_start_at: null, race_duration_minutes: null, race_lap_limit: 215,
  session_duration_minutes: null, session_timing_status: "partial", label, active: true,
}));

const roles = {
  // A regular catalog member uses the existing tester suite-access role, but
  // deliberately has neither endurance_manager nor super_admin privileges.
  member: [{ role: "tester" }],
  manager: [{ role: "endurance_manager" }],
  superadmin: [{ role: "super_admin" }],
};
const languages = ["nl", "en"];
const viewports = { desktop: { width: 1440, height: 1100 }, mobile: { width: 390, height: 844 } };
const user = { id: "00000000-0000-4000-8000-000000000101", aud: "authenticated", role: "authenticated", email: "visual-smoke@3sm.test", app_metadata: {}, user_metadata: {}, created_at: "2026-08-13T00:00:00Z" };
const session = { access_token: "visual-smoke-token", refresh_token: "visual-smoke-refresh", expires_in: 3600, expires_at: 4102444800, token_type: "bearer", user };

const response = (route, body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const routeSupabase = async (page, role) => {
  await page.route("**/auth/v1/**", async (route) => response(route, session));
  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    const query = url.search;
    if (pathname.endsWith("/user_roles")) return response(route, roles[role]);
    if (pathname.endsWith("/endurance_iracing_events")) return response(route, events);
    if (pathname.endsWith("/endurance_iracing_event_slots")) return response(route, slots);
    if (pathname.endsWith("/endurance_events") && query.includes("iracing_catalog_event_id")) return response(route, []);
    if (pathname.includes("/rpc/endurance_iracing_slot_interest_summary")) return response(route, [
      { catalog_event_id: "event-portimao", catalog_slot_id: "slot-0", interested_count: 2, is_current_user_interested: true },
      { catalog_event_id: "event-portimao", catalog_slot_id: "slot-1", interested_count: 1, is_current_user_interested: false },
    ]);
    if (pathname.includes("/rpc/endurance_iracing_slot_interest_members")) return response(route, [
      { catalog_slot_id: "slot-0", user_id: "driver-a", iracing_name: "Driver A", display_name: "A" },
      { catalog_slot_id: "slot-0", user_id: "driver-b", iracing_name: null, display_name: "Driver B" },
    ]);
    if (pathname.includes("/rpc/endurance_iracing_interest_summary")) return response(route, [
      { catalog_event_id: "event-southern", interested_count: 3, is_current_user_interested: false },
    ]);
    if (pathname.includes("/rpc/endurance_iracing_manager_interest_overview")) return response(route, [
      { catalog_event_id: "event-portimao", interested_count: 2 },
      { catalog_event_id: "event-southern", interested_count: 3 },
    ]);
    if (pathname.includes("/rpc/endurance_set_iracing") && request.method() === "POST") return response(route, null);
    return response(route, []);
  });
};

const vite = spawn(process.execPath, ["./node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root, env: { ...process.env, ...clientEnv }, stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
vite.stdout.on("data", (chunk) => { serverLog += chunk; });
vite.stderr.on("data", (chunk) => { serverLog += chunk; });
const waitForServer = async () => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { const result = await fetch(`${baseURL}/endurance/`); if (result.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Vite did not become ready.\n${serverLog}`);
};

await mkdir(artifacts, { recursive: true });
const report = { generatedAt: new Date().toISOString(), runtime: { envSource: selectedEnv, baseURL }, scenarios: [] };
let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  for (const role of Object.keys(roles)) for (const viewportName of Object.keys(viewports)) for (const initialLanguage of languages) {
    console.log(`SCENARIO role=${role} viewport=${viewportName} language=${initialLanguage}`);
    const context = await browser.newContext({ viewport: viewports[viewportName] });
    const page = await context.newPage();
    const errors = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(`console: ${message.text()}`); });
    page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
    page.on("requestfailed", (request) => errors.push(`request: ${request.url()} ${request.failure()?.errorText}`));
    await routeSupabase(page, role);
    await page.addInitScript(({ sessionValue, lang, storageKey }) => {
      localStorage.setItem("3sm-language", lang);
      localStorage.setItem(storageKey, JSON.stringify(sessionValue));
    }, { sessionValue: session, lang: initialLanguage, storageKey: authStorageKey });
    await page.goto(`${baseURL}/endurance/`, { waitUntil: "networkidle" });
    try {
      await page.getByRole("heading", { name: "Endurance & Special Events" }).waitFor();
    } catch (error) {
      await page.screenshot({ path: path.join(artifacts, `FAILED-${role}-${viewportName}-${initialLanguage}.png`), fullPage: true });
      const diagnostic = { url: page.url(), body: (await page.locator("body").innerText()).slice(0, 4000), errors };
      await writeFile(path.join(artifacts, `FAILED-${role}-${viewportName}-${initialLanguage}.json`), JSON.stringify(diagnostic, null, 2));
      throw error;
    }

    const isManager = role !== "member";
    const initialBadge = initialLanguage === "nl" ? "2 geïnteresseerde coureurs" : "2 interested drivers";
    if (isManager) await page.getByLabel(initialBadge).waitFor();
    else if (await page.getByLabel(initialBadge).count()) throw new Error(`${role} unexpectedly sees manager badge`);

    const targetLanguage = initialLanguage === "nl" ? "en" : "nl";
    const languageButton = page.getByRole("button", { name: targetLanguage.toUpperCase(), exact: true });
    const clickableLanguageIndex = async () => {
      const viewport = page.viewportSize();
      for (let index = 0; index < await languageButton.count(); index += 1) {
        const box = await languageButton.nth(index).boundingBox();
        if (box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height) return index;
      }
      return -1;
    };
    let languageIndex = await clickableLanguageIndex();
    if (languageIndex < 0) {
      const menuButton = page.getByRole("button", { name: "Open menu" });
      if (await menuButton.count()) {
        await menuButton.click();
        languageIndex = await clickableLanguageIndex();
      } else {
        const rectangles = [];
        for (let index = 0; index < await languageButton.count(); index += 1) rectangles.push(await languageButton.nth(index).boundingBox());
        await page.screenshot({ path: path.join(artifacts, `FAILED-language-${role}-${viewportName}-${initialLanguage}.png`), fullPage: true });
        throw new Error(`No menu fallback; language rectangles=${JSON.stringify(rectangles)} viewport=${JSON.stringify(page.viewportSize())}`);
      }
    }
    if (languageIndex < 0) throw new Error(`No ${targetLanguage.toUpperCase()} language button is inside the viewport`);
    await languageButton.nth(languageIndex).click();
    const closeMenuButton = page.getByRole("button", { name: "Sluit menu" });
    if (await closeMenuButton.count()) await closeMenuButton.click();
    const detailsSouthern = targetLanguage === "nl" ? "Details voor Southern 500 bekijken" : "View details for Southern 500";
    await page.getByRole("button", { name: detailsSouthern }).click();
    const heart = targetLanguage === "nl" ? "Ik heb interesse in dit event" : "I am interested in this event";
    await page.getByRole("button", { name: heart }).waitFor();
    const dialog = page.getByRole("dialog");
    const overflow = await dialog.evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
    if (overflow.scrollWidth > overflow.clientWidth + 1) throw new Error(`dialog overflow ${overflow.scrollWidth}>${overflow.clientWidth}`);
    await page.screenshot({ path: path.join(artifacts, `${role}-${viewportName}-${initialLanguage}-to-${targetLanguage}-heart.png`), fullPage: true });
    await page.keyboard.press("Escape");

    const detailsPortimao = targetLanguage === "nl" ? "Details voor Portimão 1000 bekijken" : "View details for Portimão 1000";
    await page.getByRole("button", { name: detailsPortimao }).click();
    const slotAction = targetLanguage === "nl" ? "Ik kan dit tijdslot" : "I can make this time slot";
    await page.getByRole("button", { name: slotAction }).first().waitFor();
    if (isManager) {
      await dialog.getByText(/Driver A, Driver B/).waitFor();
    } else {
      await page.waitForTimeout(150);
      const body = await dialog.innerText();
      if (body.includes("Driver A") || body.includes("Driver B")) throw new Error("member sees manager-only names");
    }
    const visibleText = await page.locator("body").innerText();
    if (targetLanguage === "nl" && /\btimeslots?\b/i.test(visibleText)) throw new Error("visible Dutch copy still contains timeslot");
    if (targetLanguage === "en") {
      const forbiddenDutch = [/\btijdslots?\b/i, /Officiële klassen/i, /Beschikbaar:/i, /Deze gaan we rijden/i, /Kwalificatie/i, /Niet gepubliceerd/i];
      const staleLines = visibleText.split("\n").filter((line) => forbiddenDutch.some((pattern) => pattern.test(line)));
      if (staleLines.length) throw new Error(`visible English catalog copy is still Dutch: ${JSON.stringify(staleLines)}`);
    }
    const pageOverflow = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    if (pageOverflow.scrollWidth > pageOverflow.clientWidth + 1) throw new Error(`page overflow ${pageOverflow.scrollWidth}>${pageOverflow.clientWidth}`);
    await page.screenshot({ path: path.join(artifacts, `${role}-${viewportName}-${initialLanguage}-to-${targetLanguage}-slots.png`), fullPage: true });
    if (errors.length) throw new Error(errors.join("\n"));
    report.scenarios.push({ role, viewport: viewportName, initialLanguage, switchedTo: targetLanguage, badgeVisible: isManager, heart: true, perSlot: true, managerNamesVisible: isManager, overflow: false, errors: [] });
    await context.close();
  }
} finally {
  if (browser) await browser.close();
  vite.kill("SIGTERM");
  await new Promise((resolve) => vite.once("exit", resolve));
  await writeFile(path.join(artifacts, "report.json"), JSON.stringify(report, null, 2));
}
console.log(`VISUAL_SMOKE_OK scenarios=${report.scenarios.length} artifacts=${artifacts}`);
