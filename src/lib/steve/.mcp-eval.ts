export default async function(bot: any, state: any) { const { vec3 } = await import("typecraft");
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
bot.chat("/tp @s 657.7 53 737.3"); await sleep(900);
const blk=(x,y,z)=>bot.blockAt(vec3(x,y,z));
const isW=(x,y,z)=>{const b=blk(x,y,z);return !!b&&b.name.includes("water");};
const isA=(x,y,z)=>{const b=blk(x,y,z);return !b||b.name==="air"||b.name==="cave_air";};
const pass=(x,y,z)=>isW(x,y,z)||isA(x,y,z);
const sol=(x,y,z)=>{const b=blk(x,y,z);return !!b&&!b.name.includes("water")&&b.name!=="air"&&b.name!=="cave_air"&&b.name!=="bedrock";};
const occ=(x,y,z)=>pass(x,y,z)&&pass(x,y+1,z);
const walk=(x,y,z)=>sol(x,y-1,z)&&occ(x,y,z);
const P=bot.entity.position; const s={x:Math.floor(P.x),y:Math.floor(P.y),z:Math.floor(P.z)};
const K=c=>c.x+","+c.y+","+c.z; const par=new Map(); const seen=new Set([K(s)]); const q=[s]; let goal=null;
const H=[[1,0],[-1,0],[0,1],[0,-1]];
while(q.length&&seen.size<9000){ const c=q.shift(); if(walk(c.x,c.y,c.z)&&c.y>=61){goal=c;break;} const ns=[];
  for(const [dx,dz] of H) if(occ(c.x+dx,c.y,c.z+dz)) ns.push({x:c.x+dx,y:c.y,z:c.z+dz});
  if(occ(c.x,c.y-1,c.z)) ns.push({x:c.x,y:c.y-1,z:c.z});
  if(isW(c.x,c.y,c.z)&&occ(c.x,c.y+1,c.z)) ns.push({x:c.x,y:c.y+1,z:c.z});
  for(const [dx,dz] of H) if(walk(c.x+dx,c.y+1,c.z+dz)&&occ(c.x,c.y+1,c.z)) ns.push({x:c.x+dx,y:c.y+1,z:c.z+dz});
  for(const n of ns){const k=K(n); if(seen.has(k)||Math.abs(n.x-s.x)>26||Math.abs(n.z-s.z)>26||n.y<42||n.y>96)continue; seen.add(k); par.set(k,c); q.push(n);} }
if(!goal) return {err:"no path"};
const path=[]; let cur=goal; while(cur){path.push([cur.x,cur.y,cur.z]);cur=par.get(K(cur));} path.reverse();
let maxY=s.y; const t0=Date.now();
for(let i=1;i<path.length && Date.now()-t0<48000;i++){
  const [tx,ty,tz]=path[i];
  for(let t=0;t<10;t++){
    const p=bot.entity.position; const d=Math.hypot(tx+0.5-p.x, tz+0.5-p.z); const dy=ty-p.y;
    if(d<0.55 && Math.abs(dy)<1.0) break;
    await bot.lookAt(vec3(tx+0.5, p.y+(dy>0.3?1.2:-0.2), tz+0.5));
    bot.setControlState("forward",true);
    bot.setControlState("jump", bot.entity.isInWater || dy>0.3);
    await sleep(170);
  }
  if(bot.entity.position.y>maxY)maxY=bot.entity.position.y;
}
bot.clearControlStates(); const p=bot.entity.position;
return { pathLen:path.length, maxYreached:Math.round(maxY*10)/10, finalPos:[Math.round(p.x),Math.round(p.y*10)/10,Math.round(p.z)], inWater:bot.entity.isInWater, onGround:bot.entity.onGround, OUT:(!bot.entity.isInWater&&bot.entity.onGround) };
 }
