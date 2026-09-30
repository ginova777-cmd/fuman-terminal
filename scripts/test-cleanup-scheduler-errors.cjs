const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict'),{createRequire}=require('module');
const file=path.join(__dirname,'verify-daily-retention-maintenance.js'),original=createRequire(file);
const source=fs.readFileSync(file,'utf8').split('main().catch(')[0];
let command;
const ctx={require:name=>name==='child_process'?{spawnSync:(exe,args)=>{command=args.join(' ');return {status:1,stdout:'[{"name":"fake","missing":true}]',stderr:'HRESULT 0x80041003 Permission denied'};}}:original(name),__dirname,process,console,Intl,Date};
vm.createContext(ctx);vm.runInContext(source,ctx);const result=vm.runInContext('scheduledTasks()',ctx);
assert.equal(result.ok,false);assert.equal(result.rows.length,0);assert.match(result.stderr,/0x80041003/);assert(command.includes('Get-ScheduledTask -TaskName $name -ErrorAction Stop'));assert(!command.includes('SilentlyContinue'));
console.log('PASS denied scheduler access stays query failure, never fabricated missing tasks');
