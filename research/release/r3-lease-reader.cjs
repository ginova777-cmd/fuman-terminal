'use strict';
// Independent read-only PostgREST view of fugle_daytrade_source_writer_lease.
async function readLease({base,key,expected,fetchImpl=fetch,now=Date.now()}){
 const unknown=reason=>({status:'UNKNOWN',reason,read_only:true});
 try{
  const u=new URL(base);if(u.protocol!=='https:'&&u.hostname!=='127.0.0.1')return unknown('UNTRUSTED_TRANSPORT');
  u.pathname=u.pathname.replace(/\/$/,'')+'/v_fugle_daytrade_source_writer_lease';
  u.search=new URLSearchParams({select:'source_name,writer_host_id,writer_instance_id,trade_date,lease_expires_at,lease_remaining_seconds,heartbeat_at,updated_at',source_name:'eq.'+expected.source_name,limit:'2'});
  const r=await fetchImpl(u,{method:'GET',redirect:'error',headers:{apikey:key||'',Authorization:key?'Bearer '+key:'',Prefer:'count=exact'},signal:AbortSignal.timeout(12000)});
  if(!r.ok)return unknown('HTTP_'+r.status);
  if(r.headers.get('content-range')!=='0-0/1')return unknown('LEASE_ROW_COUNT');
  const chunks=[];let size=0;for await(const b of r.body){size+=b.length;if(size>65536)return unknown('RESPONSE_LIMIT');chunks.push(b);}
  const rows=JSON.parse(Buffer.concat(chunks));if(!Array.isArray(rows)||rows.length!==1)return unknown('LEASE_ROW_COUNT');const row=rows[0];
  for(const k of ['source_name','writer_host_id','writer_instance_id','trade_date'])if(!expected[k]||row[k]!==expected[k])return unknown('LEASE_IDENTITY');
  const expiry=Date.parse(row.lease_expires_at),server=Date.parse(r.headers.get('date'));
  if(!Number.isFinite(expiry)||!Number.isFinite(server)||Math.abs(now-server)>15000||!Number.isInteger(row.lease_remaining_seconds)||row.lease_remaining_seconds<0)return unknown('LEASE_TIME_UNKNOWN');
  // A claim response is never consumed here. Expiry is distinct from explicit release.
  if(expiry>server||row.lease_remaining_seconds>0)return {status:'ACTIVE',row,checked_at:new Date(now).toISOString(),read_only:true};
  return {status:'RELEASED',basis:'EXPIRED_AT_SERVER_READBACK_NOT_RELEASE_RPC',row,checked_at:new Date(now).toISOString(),read_only:true};
 }catch(e){return unknown(e.name==='TimeoutError'?'TIMEOUT':'READ_FAILED');}
}
function assertBoundary({lease,inventory,locks,writerExited}){
 if(inventory?.complete!==true||!Array.isArray(inventory.unknown_pids)||inventory.unknown_pids.length)throw Error('UNKNOWN_PID');
 if(locks?.verified!==true||locks.owner_verified!==true)throw Error('UNKNOWN_LOCK');
 if(writerExited!==true)throw Error('WRITER_PRESENT');
 if(lease?.status!=='RELEASED'||lease.read_only!==true)throw Error('LEASE_NOT_RELEASED');
 if(!Number.isFinite(Date.parse(lease.checked_at))||Date.now()-Date.parse(lease.checked_at)>15000||Date.parse(lease.checked_at)>Date.now())throw Error('LEASE_STALE');
}
module.exports={readLease,assertBoundary};
