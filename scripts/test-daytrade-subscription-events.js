const assert = require('node:assert/strict');
const {EventEmitter}=require('events');
const {startSubscriptionEvents}=require('../lib/daytrade-subscription-events');
let now=Date.parse('2026-09-30T00:44:59Z'), seq=0;
const timers=new Map(), watchers=[], events=[];
function advance(ms){const end=now+ms;while(true){const entry=[...timers].filter(([,x])=>x.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!entry)break;timers.delete(entry[0]);now=entry[1].at;entry[1].fn();}now=end;}
const stop=startSubscriptionEvents({files:['C:/cache/symbols.json','C:/cache/priority.json'],now:()=>now,setTimer:(fn,ms)=>{timers.set(++seq,{fn,at:now+ms});return seq;},clearTimer:id=>timers.delete(id),watch:(dir,cb)=>{const w=new EventEmitter();w.close=()=>{w.closed=true;};w.cb=cb;watchers.push(w);return w;},onChange:x=>events.push(x),onError:e=>{throw e;}});
assert.equal(watchers.length,1);
advance(1250);assert.deepEqual(events,['session_boundary']);
advance(300000);assert.equal(events.length,1,'no five minute polling');
watchers[0].cb('change','unrelated.json');advance(300);assert.equal(events.length,1);
watchers[0].cb('rename','priority.json');watchers[0].cb('change','priority.json');advance(250);assert.equal(events.at(-1),'manifest_changed');assert.equal(events.length,2);
stop();watchers[0].cb('change','symbols.json');advance(86400000);assert.equal(events.length,2);assert(watchers[0].closed);assert.equal(timers.size,0);
console.log('PASS: boundary, no polling, atomic rename, debounce, unrelated writes, cleanup');
