'use strict';
// Windows may hand off an elevated launcher to a non-elevated browser.
// A clean launcher exit is neither a failure nor readiness; CDP still must pass.
function failedExit(code){return code!==null&&code!==0;}
module.exports={failedExit};
