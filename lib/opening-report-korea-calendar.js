"use strict";
const sources = [
 "https://www.bok.or.kr/eng/main/contents.do?menuNo=400373",
 "https://global.krx.co.kr/contents/GLB/06/0602/0602010201/GLB0602010201T1.jsp"
];
// Verified public holidays, not a claim to enumerate emergency KRX closures.
const holidays = new Set(["01-01","02-16","02-17","02-18","03-01","03-02","05-01","05-05","05-24","05-25","06-03","06-06","07-17","08-15","09-24","09-25","09-26","10-03","10-05","10-09","12-25"].map(d=>"2026-"+d));
function closure(date) {
 if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
 const t = new Date(date+"T00:00:00Z");
 if (!Number.isFinite(+t) || t.toISOString().slice(0,10)!==date) return null;
 const weekend = [0,6].includes(t.getUTCDay());
 if (!weekend && !holidays.has(date) && date!=="2026-12-31") return null;
 return {market:"KRX",date,status:"closed",reason:weekend?"weekend":date==="2026-12-31"?"year_end":"public_holiday",sources,verified_on:"2026-10-05"};
}
module.exports={closure};
