'use strict';
// Ordinary TSE/OTC equities only. Walk the legal price ladder across boundaries.
// A non-quotable computed level keeps its exact value; take the nearest two
// legal quotes on either side, rather than rounding the cost to another price.
const bands=[[0,10,.01],[10,50,.05],[50,100,.1],[100,500,.5],[500,1000,1],[1000,Infinity,5]];
function adjacent(value,direction){
 if(!Number.isFinite(value)||value<=0)throw Error('INVALID_LEVEL');
 const band=bands.find(([lo,hi])=>direction<0?value>lo&&value<=hi:value>=lo&&value<hi);
 const step=band[2],scaled=value/step;
 const n=direction>0?Math.floor(scaled+1e-8)+1:Math.ceil(scaled-1e-8)-1;
 return Math.round(n*step*100)/100;
}
function bounds(price){return {lower:adjacent(adjacent(price,-1),-1),upper:adjacent(adjacent(price,1),1),ticks_each_side:2};}
function touch({level,bar,previousClose}){
 if(!Number.isFinite(level?.price)||level.price<=0)return {matched:false,reason:'LEVEL_SOURCE_MISSING'};
 if(!Number.isFinite(bar?.low)||!Number.isFinite(bar?.high)||bar.low>bar.high)return {matched:false,reason:'INVALID_BAR'};
 const range=bounds(level.price),overlap=bar.low<=range.upper+1e-8&&bar.high>=range.lower-1e-8;
 // C appears as P1 and S3. Preserve the user's distinct approach directions.
 const approach=level.id==='P1'?Number.isFinite(previousClose)&&previousClose<level.price:level.id==='S3'?Number.isFinite(previousClose)&&previousClose>level.price:true;
 return {matched:overlap&&approach,...range,reason:!overlap?'OUTSIDE_TWO_TICKS':!approach?'APPROACH_NOT_PROVEN':null};
}
module.exports={adjacent,bounds,touch};
