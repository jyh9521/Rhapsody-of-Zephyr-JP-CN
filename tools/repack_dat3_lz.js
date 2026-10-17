const fs=require('fs');
const {decodeResource}=require('/sessions/nifty-adoring-ramanujan/mnt/ZEP_WIN/tools/zep_decode.js');
const ROOT='/sessions/nifty-adoring-ramanujan/mnt/ZEP_WIN';
const hdr=fs.readFileSync(`${ROOT}/ZEP_DAT3.HDR.bak_before_lz_reenc_20260716_142323`);
const lib=fs.readFileSync(`${ROOT}/ZEP_DAT3.LIB.bak_before_lz_reenc_20260716_142323`);
const repl={'FLTFA01._AC':fs.readFileSync('/tmp/enc2_3_FLTFA01._AC'),'FLTFA01_._AC':fs.readFileSync('/tmp/enc2_3_FLTFA01_._AC')};
const outHdr=Buffer.from(hdr);const chunks=[];let offset=0,used=0;const entries=[];
for(let off=16;off<hdr.length;off+=32){let end=off;while(end<off+16&&hdr[end]!==0)end++;const name=hdr.subarray(off,end).toString('latin1');if(!name)continue;entries.push({name,offset:hdr.readUInt32LE(off+16),size:hdr.readUInt32LE(off+20),ho:off});}
for(const e of entries){const buf=repl[e.name]?(used++,repl[e.name]):lib.subarray(e.offset,e.offset+e.size);
 outHdr.writeUInt32LE(offset,e.ho+16);outHdr.writeUInt32LE(buf.length,e.ho+20);chunks.push(buf);offset+=buf.length;}
const outLib=Buffer.concat(chunks);
// verify all decode identical to backup
let noff={};for(let off=16;off<outHdr.length;off+=32){let end=off;while(end<off+16&&outHdr[end]!==0)end++;const name=outHdr.subarray(off,end).toString('latin1');if(name)noff[name]=[outHdr.readUInt32LE(off+16),outHdr.readUInt32LE(off+20)];}
let bad=0;
for(const e of entries){const [no,ns]=noff[e.name];
 let d1=null,d2=null;try{d1=decodeResource(lib.subarray(e.offset,e.offset+e.size)).data}catch{};try{d2=decodeResource(outLib.subarray(no,no+ns)).data}catch{};
 if((d1===null)!==(d2===null)||(d1&&Buffer.compare(d1,d2)!==0)){bad++;console.log('MISMATCH',e.name);}}
console.log(`replaced=${used} verify mismatches=${bad} lib=${outLib.length}`);
if(bad===0){fs.writeFileSync('/tmp/NEW2_ZEP_DAT3.HDR',outHdr);fs.writeFileSync('/tmp/NEW2_ZEP_DAT3.LIB',outLib);console.log('written');}
