import sharp from 'sharp';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';

export const ROAD_IDS = [145,146,168,173,175,176,202,207,209,211,215,216,239,242,244,319];
const SOURCE_REVISION='b182cb7faeda236cce740530e52f3774364f3c0b';
// Reviewed overpass display gaps in the official artwork, NOT missing road.
const BRIDGE_ENDS={
  168:[[789,554],[839,638]],173:[[789,554],[839,638]],175:[[789,554],[838,637]],176:[[788,552],[838,637]],
  202:[[1561,528],[1644,545]],207:[[1561,528],[1644,545]],209:[[1561,528],[1644,545]],211:[[1561,528],[1644,545]],
  239:[[606,520],[659,566]],242:[[602,515],[655,566]],244:[[606,520],[655,566]],
};
const sha=value=>createHash('sha256').update(value).digest('hex');
const normalize=value=>value.toString().replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').trim();

// Offline thinning of the official filled course ribbon. Never used on incoming
// telemetry and never substitutes a real-world circuit for its iRacing layout.
export function thin(mask, width, height) {
  const offsets = [-width, -width+1, 1, width+1, width, width-1, -1, -width-1];
  let changed = true;
  while (changed) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      const remove = [];
      for (let y = 1; y < height-1; y++) for (let x = 1; x < width-1; x++) {
        const i = y*width+x;
        if (!mask[i]) continue;
        const p = offsets.map(d => mask[i+d]);
        const count = p.reduce((a,b) => a+b,0);
        if (count < 2 || count > 6) continue;
        let transitions = 0;
        for (let j=0;j<8;j++) if (!p[j] && p[(j+1)%8]) transitions++;
        if (transitions !== 1) continue;
        if (pass === 0 ? p[0]*p[2]*p[4] || p[2]*p[4]*p[6] : p[0]*p[2]*p[6] || p[0]*p[4]*p[6]) continue;
        remove.push(i);
      }
      for (const i of remove) mask[i]=0;
      changed ||= remove.length > 0;
    }
  }
  return mask;
}

export function skeletonGraph(mask, width) {
  const graph = new Map();
  for (let i=0;i<mask.length;i++) if (mask[i]) {
    const adjacent = [];
    for (let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) {
      if (!dx && !dy) continue;
      const j=i+dy*width+dx;
      if (!mask[j]) continue;
      // Do not introduce diagonal shortcuts across an existing right angle.
      if (dx && dy && (mask[i+dx] || mask[i+dy*width])) continue;
      adjacent.push(j);
    }
    graph.set(i, new Set(adjacent));
  }
  return graph;
}

function removeNode(graph,i) { for (const j of graph.get(i) ?? []) graph.get(j)?.delete(i); graph.delete(i); }

export function pruneSpurs(graph, limit=45) {
  let changed=true;
  while(changed) {
    changed=false;
    for(const [start,edges] of graph) {
      if(edges.size!==1) continue;
      const path=[start]; let previous=start; let current=[...edges][0];
      while(graph.get(current)?.size===2 && path.length<limit) {
        path.push(current); const next=[...graph.get(current)].find(n=>n!==previous); previous=current; current=next;
      }
      if(graph.get(current)?.size>2 && path.length<limit) { for(const i of path) removeNode(graph,i); changed=true; }
    }
  }
  return graph;
}

export function components(graph) {
  const seen=new Set(); const result=[];
  for(const start of graph.keys()) {
    if(seen.has(start)) continue;
    const group=[]; const queue=[start]; seen.add(start);
    for(let q=0;q<queue.length;q++) {
      const i=queue[q]; group.push(i);
      for(const j of graph.get(i)) if(!seen.has(j)) { seen.add(j); queue.push(j); }
    }
    result.push(group);
  }
  return result.sort((a,b)=>b.length-a.length);
}

export function trace(graph,group,width) {
  const endpoints=group.filter(i=>graph.get(i).size===1);
  const start=endpoints[0] ?? group[0];
  const points=[]; const seen=new Set(); let current=start;
  while(!seen.has(current)) {
    seen.add(current); points.push({x:current%width,y:Math.floor(current/width)});
    const next=[...graph.get(current)].find(i=>!seen.has(i));
    if(next==null) break;
    current=next;
  }
  if(seen.size!==group.length) throw Error('Centerline is not one unambiguous traversal');
  return points;
}

export function resample(points,count=1024) {
  // Smooth pixel stair-steps without changing the route or crossing order.
  const smooth=points.map((_,i)=>{
    let x=0,y=0;
    for(let d=-3;d<=3;d++) {const p=points[(i+d+points.length)%points.length];x+=p.x;y+=p.y;}
    return {x:x/7,y:y/7};
  });
  const lengths=smooth.map((p,i)=>Math.hypot(p.x-smooth[(i+1)%smooth.length].x,p.y-smooth[(i+1)%smooth.length].y));
  const total=lengths.reduce((a,b)=>a+b,0);
  let segment=0,offset=0;
  return Array.from({length:count},(_,i)=>{
    const distance=i*total/count;
    while(segment<lengths.length-1 && offset+lengths[segment]<distance) offset+=lengths[segment++];
    const ratio=lengths[segment]?(distance-offset)/lengths[segment]:0;
    const a=smooth[segment],b=smooth[(segment+1)%smooth.length];
    return {x:a.x+ratio*(b.x-a.x),y:a.y+ratio*(b.y-a.y)};
  });
}

export async function inspectRoadSources(sourceRoot,generate=false) {
  const metadata=JSON.parse((await readFile(join(sourceRoot,'iracing-tracks-metadata.json'),'utf8')).replace(/^\uFEFF/,''));
  const configs=metadata.tracks.flatMap(t=>t.configurations);
  const rows=[];
  for(const id of ROAD_IDS) {
    const config=configs.find(c=>c.track_id===id);
    if(config.is_oval || config.is_dirt || config.track_type_text!=='Road Course') throw Error(`Not road: ${id}`);
    const source=await readFile(join(sourceRoot,config.svg_local_path,'active.svg'));
    const {data,info}=await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const mask=new Uint8Array(info.width*info.height);
    for(let i=0;i<mask.length;i++) mask[i]=data[i*info.channels+info.channels-1]>127?1:0;
    const graph=pruneSpurs(skeletonGraph(thin(mask,info.width,info.height),info.width));
    const groups=components(graph);
    const main=new Set(groups[0]);
    const endpoints=[...graph].filter(([i,e])=>main.has(i)&&e.size===1).map(([i])=>[i%info.width,Math.floor(i/info.width)]);
    const branches=[...graph].filter(([i,e])=>main.has(i)&&e.size>2).map(([i,e])=>[i%info.width,Math.floor(i/info.width),e.size]);
    const row={id,name:config.track_name_and_config,groups:groups.map(g=>g.length),endpoints,branches};
    if(generate) {
      if(groups.length!==1 || branches.length || ![0,2].includes(endpoints.length)) throw Error(`Ambiguous topology: ${id}`);
      if(endpoints.length) {
        const expected=BRIDGE_ENDS[id];
        if(!expected || endpoints.some(p=>!expected.some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<2))) throw Error(`Unreviewed bridge: ${id}`);
      }
      const mapPath=`/tracks/layered/track-${id}.svg`;
      const outer=await readFile(`public${mapPath}`,'utf8');
      const image=[...outer.matchAll(/<image\b[^>]*\/>/g)].map(m=>m[0]).find(s=>s.includes('filter="url(#activeColor)"'));
      const active=Buffer.from(image.match(/base64,([^"]+)/)[1],'base64');
      if(normalize(active)!==normalize(source)) throw Error(`Source differs from shipped map: ${id}`);
      let points=trace(graph,groups[0],info.width);
      if(endpoints.length) {
        // Explicit short straight connection under the overpass, sampled before
        // smoothing so the display gap cannot produce an across-map jump.
        const a=points.at(-1),b=points[0],steps=Math.ceil(Math.hypot(a.x-b.x,a.y-b.y));
        points.push(...Array.from({length:steps-1},(_,i)=>({x:a.x+(b.x-a.x)*(i+1)/steps,y:a.y+(b.y-a.y)*(i+1)/steps})));
      }
      row.points=resample(points);
      row.outer=outer;
      row.mapPath=mapPath;
      row.turns=await readFile(join(sourceRoot,config.svg_local_path,'turns.svg'),'utf8');
      row.sourcePath=config.svg_local_path;
    }
    rows.push(row);
  }
  return rows;
}

async function generate(sourceRoot,baseUrl) {
  if(execFileSync('git',['rev-parse','HEAD'],{cwd:sourceRoot,encoding:'utf8'}).trim()!==SOURCE_REVISION) throw Error('Unreviewed upstream revision');
  execFileSync('git',['diff','--quiet','HEAD','--','.'],{cwd:sourceRoot});
  const rows=await inspectRoadSources(sourceRoot,true);
  const browser=await chromium.launch({...(process.platform==='win32'?{channel:'chrome'}:{}),headless:true});
  try {
    const page=await browser.newPage();
    await page.route('**/road-generation.html',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Offline road generation</title>'}));
    await page.goto(new URL('/road-generation.html',baseUrl).href);
    for(const row of rows) {
      const reference=await page.evaluate(async row=>{
        const {readOfficialTrackReference,orientProjectionPoints,applySvgTransform}=await import('/src/lib/pitwallTrackGeometry.ts');
        const ref=readOfficialTrackReference(row.outer);
        if(!ref.start) throw Error(`Missing start: ${row.id}`);
        let points=orientProjectionPoints(row.points,ref.start,ref.direction,ref.directionLocation);
        const doc=new DOMParser().parseFromString(row.turns,'image/svg+xml');
        const markers=Array.from(doc.querySelectorAll('text')).map(element=>{
          let p=[{x:Number(element.getAttribute('x'))+10,y:Number(element.getAttribute('y'))-12}];
          for(let node=element;node;node=node.parentElement) p=applySvgTransform(p,node.getAttribute('transform')??'');
          return {label:element.textContent.trim(),...p[0]};
        }).filter(p=>/^\d+$/.test(p.label));
        const nearest=(p,list)=>list.reduce((best,q,i)=>Math.hypot(q.x-p.x,q.y-p.y)<Math.hypot(list[best].x-p.x,list[best].y-p.y)?i:best,0);
        if(!ref.direction) {
          // Only labels 1..3 are needed; Detroit's split glyphs for turn 11
          // are later duplicates and must not become false turn-one anchors.
          const early=[1,2,3].map(n=>markers.find(p=>p.label===String(n)));
          if(early.some(p=>!p)) throw Error(`Missing turn anchors: ${row.id}`);
          const indices=early.map(p=>nearest(p,points));
          if(indices[0]>indices[1] && indices[1]>indices[2]) points=[points[0],...points.slice(1).reverse()];
          else if(!(indices[0]<indices[1] && indices[1]<indices[2])) throw Error(`Ambiguous turn order: ${row.id}`);
        }
        return {points,start:ref.start,directionSource:ref.direction?'official-arrow':'official-turn-order',markers};
      },row);
      const result={schemaVersion:1,trackId:row.id,mapPath:row.mapPath,mapSha256:sha(row.outer.replace(/\r\n/g,'\n')),sourceRevision:SOURCE_REVISION,
        sourcePath:row.sourcePath,activeSha256:sha(normalize(Buffer.from([...row.outer.matchAll(/<image\b[^>]*\/>/g)].map(m=>m[0]).find(s=>s.includes('filter="url(#activeColor)"')).match(/base64,([^"]+)/)[1],'base64'))),
        turnsSha256:sha(normalize(row.turns)),directionSource:reference.directionSource,start:reference.start,bridgeEndpoints:row.endpoints,
        turnMarkers:reference.markers,points:reference.points.map(p=>[Number(p.x.toFixed(2)),Number(p.y.toFixed(2))])};
      const {data,info}=await sharp(await readFile(join(sourceRoot,row.sourcePath,'active.svg'))).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      for(const [x,y] of result.points) {
        const painted=data[(Math.round(y)*info.width+Math.round(x))*info.channels+info.channels-1]>127;
        if(painted) continue;
        const [a,b]=row.endpoints;
        if(!a||!b) throw Error(`Centerline left the official ribbon: ${row.id} at ${x},${y}`);
        const dx=b[0]-a[0],dy=b[1]-a[1];
        const t=((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy);
        const distance=Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy);
        if(t < -0.05 || t > 1.05 || distance > 5) throw Error(`Unreviewed off-course point: ${row.id} at ${x},${y}`);
      }
      await mkdir('public/tracks/projections',{recursive:true});
      await writeFile(`public/tracks/projections/track-${row.id}.json`,JSON.stringify(result)+'\n');
      console.log(`${row.id}: ${reference.points.length} points, ${reference.directionSource}, ${row.endpoints.length?'reviewed bridge':'closed loop'}`);
    }
  } finally {await browser.close();}
}

if(process.argv[1]?.endsWith('road-track-centerlines.mjs')) {
  if(process.argv.includes('--generate')) await generate(process.argv[2],process.argv[3]??'http://127.0.0.1:4193');
  else console.log(JSON.stringify(await inspectRoadSources(process.argv[2]),null,2));
}
