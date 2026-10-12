'use strict';
// Both package producer and verifier must hash these exact bytes.
function exactDiffArgs(base,target){return ['diff','--binary','--full-index','--no-ext-diff','--no-textconv','--no-color','--no-renames','--src-prefix=a/','--dst-prefix=b/','--diff-algorithm=myers','--no-indent-heuristic','--unified=3','--inter-hunk-context=0',base,target,'--'];}
module.exports={exactDiffArgs};
