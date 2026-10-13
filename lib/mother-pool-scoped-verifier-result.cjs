'use strict';
// Scoped verification is never total A/B acceptance. Require exactly the
// requested set and the current Writer round before allowing its consumer.
function accepted(result,exitCode,requested,writerRunId){
 if(exitCode!==0||result?.scope!=='selected_modules'||result.selected_modules_passed!==true||result.required_writer_run_id!==writerRunId||!writerRunId)return false;
 const same=a=>Array.isArray(a)&&a.length===requested.length&&new Set(a).size===a.length&&requested.every(id=>a.includes(id));
 return same(result.requested)&&same(result.results?.map(r=>r.module_id))&&result.results.every(r=>r.complete===true)&&Array.isArray(result.read_errors)&&result.read_errors.length===0;
}
module.exports={accepted};
