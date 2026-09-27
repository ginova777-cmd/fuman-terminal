'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {bounds,touch}=require('./level-touch.cjs');
test('two ticks each side across every equity band boundary',()=>{
 for(const [price,lower,upper]of [[9,8.98,9.02],[10,9.98,10.1],[50,49.9,50.2],[100,99.8,101],[500,499,502],[1000,998,1010]])assert.deepEqual(bounds(price),{lower,upper,ticks_each_side:2});
});
test('unrounded weighted costs use two neighboring legal quotes on either side',()=>{assert.deepEqual(bounds(100.23),{lower:99.9,upper:101,ticks_each_side:2});});
test('inclusive edges, wick touch and exclusion outside band',()=>{
 const level={id:'S1',price:100};
 for(const price of [99.8,100,101])assert(touch({level,bar:{low:price,high:price}}).matched);
 assert(!touch({level,bar:{low:101.5,high:102}}).matched);
 assert(touch({level,bar:{low:99,high:102}}).matched);
});
test('cost pressure and support require opposite proven approach; missing sources fail closed',()=>{
 const bar={low:99.9,high:100.5};
 assert(touch({level:{id:'P1',price:100},bar,previousClose:99}).matched);
 assert(!touch({level:{id:'P1',price:100},bar,previousClose:101}).matched);
 assert(touch({level:{id:'S3',price:100},bar,previousClose:101}).matched);
 assert(!touch({level:{id:'S3',price:100},bar}).matched);
 assert(!touch({level:{id:'S1',price:null},bar}).matched);
});
