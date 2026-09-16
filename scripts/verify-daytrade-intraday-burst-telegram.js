'use strict';
// Retired legacy equations. Compatibility entry dispatches ONLY the canonical independent contract.
const {main}=require('./verify-telegram-three-detectors');
if(require.main===module)main().then(r=>{process.exitCode=r.exit_code??(r.status==='not_due'||r.integration_complete===true?0:1);}).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={main};
