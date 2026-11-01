'use strict';
const assert=require('node:assert/strict');
const {validate,BASE,BUSINESS,GOVERNANCE}=require('../lib/terminal-ui-publish-applicability.cjs');
const head='1234567890123456789012345678901234567890';
const good={clean:true,head,releaseSha:head,main:head,remote:'https://github.com/ginova777-cmd/fuman-terminal.git',ancestor:true,businessChanges:BUSINESS,governanceChanges:GOVERNANCE,
 live:{id:'dpl_5FXRKsrAgEsaMfmv5HVMgyEDLkka',projectId:'prj_x0R2mMFsL0Xto4whcbPTKQTKJRUl',target:'production',readyState:'READY',alias:['fuman-terminal.vercel.app'],meta:{gitCommitSha:BASE}}};
assert.equal(validate(good).status,'SCOPED_UI');let cases=1;
for(const patch of [{clean:false},{head:'bad'},{releaseSha:'different'},{main:BASE},{remote:'https://example.com/repo'},{ancestor:false},{businessChanges:[...BUSINESS,'api/market.js']},{businessChanges:BUSINESS.slice(1)},{governanceChanges:['lib/daytrade-canonical-water-reader.js']},{governanceChanges:['scripts/deploy-production-safe.js']},{live:{...good.live,projectId:'other'}},{live:{...good.live,alias:['other.vercel.app']}},{live:{...good.live,target:'preview'}},{live:{...good.live,readyState:'BUILDING'}},{live:{...good.live,id:'different',meta:{gitCommitSha:'another'}}},{live:{...good.live,id:'different',meta:{gitCommitSha:BASE}}}]){assert.throws(()=>validate({...good,...patch}));cases++;}
assert.equal(validate({...good,live:{...good.live,id:'new',meta:{gitCommitSha:head}}}).status,'SCOPED_UI');cases++;
assert.deepEqual(validate(good).notApplicable,['buySellFieldContractGuard','terminal_water_root','daytrade_source_host_role']);cases++;
console.log(JSON.stringify({scope:'exact_website_only_release_profile',passed:cases,production_deployed:false}));
