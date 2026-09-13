/* Faithful-enough stub of @minecraft/server for offline smoke testing. */
export const EquipmentSlot = { Head:"Head", Chest:"Chest", Legs:"Legs", Feet:"Feet",
  Mainhand:"Mainhand", Offhand:"Offhand" };
export class ItemStack { constructor(id,n=1){ this.typeId=id; this.amount=n; } }
export class BlockPermutation { static resolve(id){ return { type:{id} }; } }

export const CALLS = { commands:[], sounds:[], spawns:[], setBlocks:0, effects:[] };

class Block {
  constructor(dim,x,y,z){ this.dimension=dim; this.x=x; this.y=y; this.z=z;
    this.typeId = y < 62 ? "minecraft:stone" : y === 62 ? "minecraft:grass_block" : "minecraft:air"; }
  setType(t){ this.typeId=t; CALLS.setBlocks++; }
  setPermutation(p){ this.typeId = p?.type?.id ?? this.typeId; CALLS.setBlocks++; }
  getLightLevel(){ return 12; }
}
class Container {
  constructor(){ this.items = new Map(); }
  getItem(i){ return this.items.get(i); }
  setItem(i,v){ if(v===undefined) this.items.delete(i); else this.items.set(i,v); }
}
class Entity {
  constructor(dim,type,loc){ this.dimension=dim; this.typeId=type;
    this.location={...loc}; this.id="e"+(Entity.n=(Entity.n||0)+1); this.isValid=true;
    this._props={"sl:state":"still","sl:decay":0}; this._dyn=new Map(); this._tags=new Set(); }
  getProperty(k){ return this._props[k]; }
  setProperty(k,v){ this._props[k]=v; }
  triggerEvent(e){ if(typeof e!=="string") throw new Error("triggerEvent needs a string");
    this._lastEvent=e; }
  addTag(t){ this._tags.add(t); return true; }
  hasTag(t){ return this._tags.has(t); }
  remove(){ this.isValid=false; }
  setRotation(r){ if(typeof r?.x!=="number"||typeof r?.y!=="number") throw new Error("bad rotation"); }
  teleport(l,o){ this.location={...l}; if(o?.dimension) this.dimension=o.dimension; }
  addEffect(id,d,o){ CALLS.effects.push(id); }
  applyDamage(n,o){ return true; }
  applyKnockback(){ return true; }
  matches(q){ return false; }
  getDynamicProperty(k){ return this._dyn.get(k); }
  setDynamicProperty(k,v){ this._dyn.set(k,v); }
  playSound(id,o){ CALLS.sounds.push(id); }
  runCommand(c){ CALLS.commands.push(c); return {successCount:1}; }
  sendMessage(m){ if(typeof m!=="string"&&!Array.isArray(m)) throw new Error("bad message"); }
  getComponent(id){
    if(id==="minecraft:health") return { currentValue:20, effectiveMax:20, setCurrentValue(){} };
    if(id==="minecraft:rideable") return { addRider(){return true;}, ejectRider(){return true;},
      getRiders(){return [];} };
    if(id==="minecraft:equippable") return { getEquipment(){ return undefined; } };
    if(id==="minecraft:inventory") return { container: this._c ??= new Container() };
    if(id==="minecraft:is_tamed") return undefined;
    if(id==="minecraft:is_baby") return undefined;
    return undefined;
  }
}
class Player extends Entity {
  constructor(dim,loc){ super(dim,"minecraft:player",loc); this.name="Tester";
    this.selectedSlotIndex=0;
    this.onScreenDisplay={ setActionBar(t){ if(typeof t!=="string") throw new Error("bad actionbar"); },
      setTitle(t,o){ if(typeof t!=="string") throw new Error("bad title"); } }; }
  getViewDirection(){ return {x:0,y:0,z:1}; }
  getHeadLocation(){ return {...this.location, y:this.location.y+1.6}; }
  getBlockFromViewDirection(o){ return { block: new Block(this.dimension,1,63,1) }; }
}
class Dimension {
  constructor(id){ this.id="minecraft:"+id; this._ents=[]; }
  getBlock(l){ if(!l||typeof l.x!=="number"||typeof l.y!=="number"||typeof l.z!=="number")
      throw new Error("getBlock: bad location "+JSON.stringify(l));
    if(l.y<-64||l.y>320) return undefined;
    return new Block(this,Math.floor(l.x),Math.floor(l.y),Math.floor(l.z)); }
  runCommand(c){ if(typeof c!=="string") throw new Error("bad command");
    CALLS.commands.push(c); return {successCount:1}; }
  spawnEntity(type,loc){ if(typeof type!=="string") throw new Error("bad entity type");
    if(!loc||typeof loc.x!=="number") throw new Error("bad spawn loc");
    CALLS.spawns.push(type); const e=new Entity(this,type,loc); this._ents.push(e); return e; }
  spawnItem(it,loc){ return new Entity(this,"minecraft:item",loc); }
  getEntities(q){ let l=this._ents.filter(e=>e.isValid);
    if(q?.type) l=l.filter(e=>e.typeId===q.type);
    if(q?.tags) l=l.filter(e=>q.tags.every(t=>e.hasTag(t)));
    if(q?.families) l=l.filter(e=>q.families.some(f=>
       (f==="still_life"&&e.typeId.startsWith("sl:still_"))||
       (f==="sl_apex"&&(e.typeId==="sl:the_tall_one"||e.typeId==="sl:captain_clark"))));
    return l; }
  getPlayers(q){ return world._players; }
  playSound(id,loc,o){ if(typeof id!=="string") throw new Error("bad sound id");
    if(!loc||typeof loc.x!=="number") throw new Error("dimension.playSound needs a location");
    CALLS.sounds.push(id); }
}
function mkEvent(){ const subs=[]; return { subscribe(f){ subs.push(f); return f; },
  unsubscribe(){}, _fire(a){ for(const f of subs) f(a); }, _subs:subs }; }

const AFTER = ["entityDie","entityHurt","entitySpawn","entityHitEntity","playerSpawn",
  "playerLeave","playerPlaceBlock","playerBreakBlock","itemUse","itemCompleteUse",
  "playerInteractWithEntity","playerInteractWithBlock","worldInitialize"];
const BEFORE = ["chatSend","playerInteractWithBlock","itemUse"];

class World {
  constructor(){
    this._dims = { overworld:new Dimension("overworld"), nether:new Dimension("nether"),
                   the_end:new Dimension("the_end") };
    this._dyn = new Map();
    this.afterEvents = {}; for(const k of AFTER) this.afterEvents[k]=mkEvent();
    this.beforeEvents = {}; for(const k of BEFORE) this.beforeEvents[k]=mkEvent();
    this._players = [];
  }
  getDimension(id){ const k=String(id).replace("minecraft:","");
    const d=this._dims[k]; if(!d) throw new Error("no dimension "+id); return d; }
  getAllPlayers(){ return this._players; }
  getPlayers(){ return this._players; }
  getDynamicProperty(k){ return this._dyn.get(k); }
  setDynamicProperty(k,v){ if(typeof k!=="string") throw new Error("bad dyn key");
    if(v!==undefined && !["string","number","boolean","object"].includes(typeof v))
      throw new Error("bad dyn value "+typeof v);
    if(typeof v==="string" && v.length>32767) throw new Error("dyn string too long: "+v.length);
    this._dyn.set(k,v); }
  getDay(){ return Math.floor(this._time/24000); }
  getAbsoluteTime(){ return this._time; }
  getTimeOfDay(){ return this._time%24000; }
  sendMessage(m){ if(typeof m!=="string") throw new Error("bad world message"); }
  _time = 0;
}
export const world = new World();

export const system = {
  currentTick: 0,
  _iv: [], _to: [], _jobs: [],
  runInterval(fn,t){ const h={fn,t:Math.max(1,t|0),next:this.currentTick+Math.max(1,t|0),id:this._iv.length};
    this._iv.push(h); return h.id; },
  runTimeout(fn,t){ this._to.push({fn,at:this.currentTick+(t|0)}); return this._to.length-1; },
  run(fn){ this._to.push({fn,at:this.currentTick}); return 0; },
  runJob(gen){ this._jobs.push(gen); return this._jobs.length-1; },
  clearRun(id){ const h=this._iv.find(x=>x.id===id); if(h) h.dead=true; },
};
export function _tick(){
  system.currentTick++; world._time += 1;
  for(const h of system._iv){ if(h.dead) continue;
    if(system.currentTick>=h.next){ h.next=system.currentTick+h.t; h.fn(); } }
  const due=system._to.filter(x=>x.at<=system.currentTick);
  system._to = system._to.filter(x=>x.at>system.currentTick);
  for(const d of due) d.fn();
  for(let i=system._jobs.length-1;i>=0;i--){
    const g=system._jobs[i];
    for(let k=0;k<300;k++){ const r=g.next(); if(r.done){ system._jobs.splice(i,1); break; } } }
}
export function _mkPlayer(loc){ const p=new Player(world._dims.overworld, loc);
  world._players.push(p); world._dims.overworld._ents.push(p); return p; }
export { Player, Entity, Dimension, Block };
