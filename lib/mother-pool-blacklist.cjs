'use strict';
const symbols=Object.freeze(['4728','6574','6597','7708','7820','8342']);
const reason='USER_BLACKLIST_LOW_LIQUIDITY_20261024';
const blocked=s=>symbols.includes(String(s||'').trim());
module.exports={symbols,reason,blocked};
