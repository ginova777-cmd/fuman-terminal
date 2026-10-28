'use strict';
const fs=require('fs'),path=require('path');
function snapshot(root){const volume=path.parse(path.resolve(root)).root,s=fs.statfsSync(volume);const freeBytes=s.bavail*s.bsize,totalBytes=s.blocks*s.bsize;if(!Number.isSafeInteger(freeBytes)||freeBytes<0||!Number.isSafeInteger(totalBytes))throw Error('capacity_readback_invalid');return {volume,freeBytes,totalBytes,checkedAt:new Date().toISOString()};}
function assess(before,after,minFreeBytes){if(!before||!after||before.volume!==after.volume||!Number.isSafeInteger(minFreeBytes)||minFreeBytes<0)throw Error('capacity_policy_invalid');return {contract:'cleanup-local-capacity-v1',before,after,minFreeBytes,freeBytesDelta:after.freeBytes-before.freeBytes,belowWatermark:after.freeBytes<minFreeBytes,spaceDeltaIsNotDeletedBytes:true};}
module.exports={snapshot,assess};
