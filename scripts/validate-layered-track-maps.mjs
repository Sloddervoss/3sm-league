import sharp from 'sharp';
import fs from 'node:fs';
const manifest=JSON.parse(fs.readFileSync('public/tracks/layered/manifest.json','utf8'));
const errors=[];
for(const track of manifest.tracks){
  try {
    await sharp(`public/tracks/layered/track-${track.trackId}.svg`).resize(480,270,{fit:'contain'}).png().toBuffer();
  } catch (error) {
    errors.push([track.trackId,String(error)]);
  }
}
console.log(JSON.stringify({status:errors.length?'FAIL':'ALL_LAYERED_SVGS_RENDER_OK',count:manifest.tracks.length,errors}));
if(errors.length) process.exitCode=1;
