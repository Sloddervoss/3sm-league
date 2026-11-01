import assert from "node:assert/strict";
import {chromium} from "playwright";
import {mkdir,writeFile} from "node:fs/promises";
import path from "node:path";
const out=path.resolve("docs/pitwall-look/pace-browser"); await mkdir(out,{recursive:true});
const executablePath=process.env.PITWALL_CHROME || path.join(process.env.HOME,".cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell");
const browser=await chromium.launch({executablePath}); const results=[];
try {
 for(const mode of ["endurance","test"]) {
  const page=await browser.newPage({viewport:{width:1920,height:1080}});const errors=[];
  page.on("pageerror",e=>{errors.push(String(e));console.error(String(e));});
  await page.route("**/*",r=>{ if(new URL(r.request().url()).hostname!=="127.0.0.1") {errors.push(`external ${r.request().url()}`); return r.abort();} return r.continue();});
  await page.goto(`http://127.0.0.1:5198/docs/pitwall-look/preview/pace-${mode}.html`,{waitUntil:"networkidle"});
  await page.locator("[data-pitwall-slot=pace]").waitFor();
  const tabs=[];
  for(const tab of ["Rondetijd","Snelheid","Delta"]) {
   await page.getByRole("button",{name:tab,exact:true}).click();
   assert.equal(await page.locator("[data-pace-line]").count(),2,`${mode} ${tab}: two real fixture lines`);
   const layout=await page.evaluate(()=>({contentFits:[...document.querySelectorAll('[data-pitwall-row="panels"] section')].every(e=>[...e.querySelectorAll('p,dl,select')].every(child=>child.getBoundingClientRect().bottom<=e.getBoundingClientRect().bottom+1)),height:document.documentElement.scrollHeight,width:document.documentElement.scrollWidth,panels:[...document.querySelectorAll('[data-pitwall-row="panels"]>div')].map(e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right};})}));
   assert(layout.contentFits,`${mode} ${tab}: content not clipped`);assert.equal(layout.panels.length,4);assert(layout.panels.every(p=>p.bottom<=1080),`${mode} ${tab}: all panels in viewport ${JSON.stringify(layout)}`);
   assert.equal(layout.width,1920);assert.equal(layout.height,1080);
   await page.screenshot({path:path.join(out,`${mode}-${tab.toLowerCase()}.png`)});
   tabs.push({tab,layout});
  }
  const selector=page.getByRole("combobox",{name:"Vergelijkingsauto"});
  const options=await selector.locator("option").evaluateAll(os=>os.map(o=>({value:o.value,text:o.textContent})));
  const missing=options.find(o=>o.value && o.value!=="p1");
  if(missing){await selector.selectOption(missing.value);assert.equal(await page.locator('[data-pace-line="reference"]').count(),0);}
  assert.deepEqual(errors,[]);results.push({mode,tabs,errors});await page.close();
 }
 await writeFile(path.join(out,"verification.json"),JSON.stringify({source:"synthetic, isolated browser fixtures; no production requests",results},null,2));
 console.log("PASS browser: both modes × 3 tabs, two lines, 4 panels inside 1920x1080, no external requests");
} finally {await browser.close();}
