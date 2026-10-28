'use strict';
// Equivalent reference-string extraction, using native string searches to skip
// numeric/whitespace spans. Every byte is still hashed and every string examined.
class ReferenceStrings {
 constructor(){this.ids=new Set();this.references=new Set();this.pending='';this.last='';this.key='';}
 outside(s){const colon=s.lastIndexOf(':'),clear=Math.max(s.lastIndexOf(','),s.lastIndexOf('}'),s.lastIndexOf(']'));if(colon>clear)this.key=this.last;else if(clear>=0)this.key='';}
 write(chunk){const s=this.pending?Buffer.from(this.pending+chunk,'utf16le').toString('utf16le'):chunk;this.pending='';let at=0;
  while(at<s.length){const start=s.indexOf('"',at);if(start<0){this.outside(s.slice(at));return;}this.outside(s.slice(at,start));let end=start;
   for(;;){end=s.indexOf('"',end+1);if(end<0){this.pending=s.slice(start);if(this.pending.length>64*1024*1024)throw Error('reference_string_over_bound');return;}let slash=end-1;while(s[slash]==='\\')slash--;if((end-1-slash)%2===0)break;}
   const token=s.slice(start+1,end);if(token.length>64*1024*1024)throw Error('reference_string_over_bound');
   const value=token.includes('\\')||/[\u0000-\u001f]/.test(token)?JSON.parse(s.slice(start,end+1)):token;
   this.last=value;const isId=/run.?id/i.test(this.key)&&value,isReference=/(?:https?:|[\\/]|\.json|\.png|\.jpg|\.pdf)|^[a-f0-9]{64}$/i.test(value);
   // Detach retained substrings from the full input chunk. UTF-16 copies preserve
   // even escaped lone surrogates, unlike a UTF-8 encode/decode round trip.
   const retained=isId||isReference?Buffer.from(value,'utf16le').toString('utf16le'):null;
   if(isId)this.ids.add(retained);if(isReference)this.references.add(retained);this.key='';at=end+1;
  }
 }
 finish(){if(this.pending)throw Error('reference_string_incomplete');return {ids:[...this.ids],references:[...this.references]};}
}
module.exports={ReferenceStrings};

