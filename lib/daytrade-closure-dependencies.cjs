'use strict';
const range=n=>Array.from({length:n},(_,i)=>'A'+String(i+1).padStart(2,'0')).filter(id=>id!=='A10');
const dependencies={A18:['A15','A16','A17'],A14:range(13),A19:range(18),B04:['B02'],B09:['B04','B08'],B17:['B01','B11'],B18:['B01'],B24:['B12','B13','B19','B21','B22','B23']};
const supplyScopes={...dependencies,B09:['B02','B04','B08']};
function needsCapture(parent,work){return work.filter(id=>id.startsWith('B')).some(id=>(dependencies[id]||[]).includes(parent));}
module.exports={dependencies,supplyScopes,needsCapture};
