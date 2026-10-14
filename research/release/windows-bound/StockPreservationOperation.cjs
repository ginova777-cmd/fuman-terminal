'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto'),{verify}=require('./stock-preserved-future.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function check(root,c,identity,inventory){
 if(c.cutover_scope!=='STOCK_ONLY_PRESERVE_FUTURES')throw Error('STOCK_SCOPE_REQUIRED');
 const bytes=fs.readFileSync(path.join(root,'stock-preservation.json'));if(hash(bytes)!==c.stock_preservation_sha256)throw Error('PRESERVATION_MANIFEST_DRIFT');
 const manifest=JSON.parse(bytes);if(manifest.expected!==c.expected||manifest.target!==c.target||manifest.contract!=='stock_futures_preservation_v1')throw Error('PRESERVATION_RELEASE_DRIFT');
 return verify(c.prod,manifest.files,identity,inventory);
}
if(require.main===module){const [identityFile,inventoryFile]=process.argv.slice(2);const c=JSON.parse(fs.readFileSync(path.join(__dirname,'release-config.json')));const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));console.log(JSON.stringify(check(__dirname,c,read(identityFile),read(inventoryFile).inventory)));}
module.exports={check};
