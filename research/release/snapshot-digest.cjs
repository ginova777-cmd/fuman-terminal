'use strict';
// Executed only after intake is frozen and the original persistence ACK drains.
function digest(file){
 const fs=require('fs'),crypto=require('crypto'),os=require('os');
 const started=Date.now(),fd=fs.openSync(file,'r'),before=fs.fstatSync(fd),h=crypto.createHash('sha256'),b=Buffer.alloc(65536);
 let bytes=0,peakRss=0,peakHeap=0,minAvailable=Infinity;
 try{for(let n;(n=fs.readSync(fd,b,0,b.length,null));){
  bytes+=n;h.update(b.subarray(0,n));
  if(bytes%1048576<n){const m=process.memoryUsage(),free=os.freemem();peakRss=Math.max(peakRss,m.rss);peakHeap=Math.max(peakHeap,m.heapUsed);minAvailable=Math.min(minAvailable,free);if(free<1073741824)throw Error('HOST_AVAILABLE_RAM');if(m.rss>536870912)throw Error('PROCESS_RSS');if(Date.now()-started>120000)throw Error('TIMEOUT');}
 }const after=fs.fstatSync(fd);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||bytes!==before.size)throw Error('SNAPSHOT_CHANGED');
 return {sha256:h.digest('hex'),bytes,peak_rss:peakRss,peak_heap:peakHeap,min_available:minAvailable,elapsed_ms:Date.now()-started};
 }finally{fs.closeSync(fd);}
}
module.exports={digest};
