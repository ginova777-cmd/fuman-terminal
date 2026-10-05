'use strict';
const crypto=require('crypto');
function canonical(x){if(x===null)return 'null';if(typeof x==='number'){if(!Number.isFinite(x))throw Error('NON_FINITE_VALUE');return JSON.stringify(x);}if(['string','boolean'].includes(typeof x))return JSON.stringify(x);if(Array.isArray(x))return '['+x.map(canonical).join(',')+']';if(x&&typeof x==='object')return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';throw Error('NON_JSON_VALUE');}
const hash=x=>crypto.createHash('sha256').update(canonical(x)).digest('hex');
function required(x,keys){for(const k of keys)if(x[k]===undefined||x[k]===null||x[k]==='')throw Error('REQUIRED:'+k);}
function instant(v){if(typeof v!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(v)||!Number.isFinite(Date.parse(v)))throw Error('TIMESTAMP_WITH_TIMEZONE_REQUIRED');return Date.parse(v);}
const date=v=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(instant(v)));
module.exports={canonical,hash,required,instant,date};
