'use strict';
function isCompleted(time,nowMs){const stamp=Date.parse(time);return Number.isFinite(stamp)&&stamp%60000===0&&Number.isFinite(nowMs)&&stamp+60000<=nowMs;}
module.exports={isCompleted};
