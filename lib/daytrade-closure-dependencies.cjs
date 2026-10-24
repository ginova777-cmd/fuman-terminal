'use strict';
const dependencies={B04:['B02'],B09:['B04','B08'],B17:['B01','B11'],B18:['B01'],B24:['B12','B13','B19','B21','B22','B23']};
const supplyScopes={...dependencies,B09:['B02','B04','B08']};
function needsCapture(parent,work){return work.some(id=>(dependencies[id]||[]).includes(parent));}
module.exports={dependencies,supplyScopes,needsCapture};
