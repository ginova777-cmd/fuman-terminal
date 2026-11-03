'use strict';
// Read-only strategy adapter: exact date, hash/provenance verification, no network or yesterday fallback.
const args=process.argv.slice(2);const get=k=>args[args.indexOf(k)+1];
if(!args.includes('--symbol')||!args.includes('--market')||!args.includes('--date'))throw Error('Usage: --symbol CODE --market TWSE|TPEX --date YYYY-MM-DD');
const result=require('../lib/mother-pool-disposition.cjs').readSymbol({runtime:args.includes('--runtime')?get('--runtime'):'C:/fuman-runtime',symbol:get('--symbol'),market:get('--market'),date:get('--date')});
console.log(JSON.stringify(result));
