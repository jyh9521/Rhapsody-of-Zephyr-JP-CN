const fs=require('fs');
const {decodeResource}=require('/sessions/nifty-adoring-ramanujan/mnt/ZEP_WIN/tools/zep_decode.js');
const {compressMulti}=require('/tmp/comp_multi.js');
const ORIG='/sessions/nifty-adoring-ramanujan/mnt/FALCOM--ZEP_WIN';
const map=JSON.parse(fs.readFileSync('/tmp/ch_namemap.json','utf8'));
function ph(p){const b=fs.readFileSync(p);const e=[];for(let o=16;o<b.length;o+=32){let x=o;while(x<o+16&&b[x])x++;const n=b.subarray(o,x).toString('latin1');if(n)e.push({n,o:b.readUInt32LE(o+16),s:b.readUInt32LE(o+20),ho:o});}return e;}
const hdr=Buffer.from(fs.readFileSync(`${ORIG}/ZEP_DAT1.HDR`));
const lib=fs.readFileSync(`${ORIG}/ZEP_DAT1.LIB`);
const entries=ph(`${ORIG}/ZEP_DAT1.HDR`);
const bf=b=>Buffer.from([...b].map(x=>(0xBF-x)&0xFF));
const chunks=[];let offset=0;
let patched=0,repls=0,verifyFail=0;
const intendedDecoded={}; // for final verification
for(const e of entries){
  const specs=map[e.n];
  let outBuf;
  if(!specs){
    outBuf=lib.subarray(e.o,e.o+e.s); // untouched, keep original bytes
    intendedDecoded[e.n]=null; // means "same as original"
  }else{
    const dec=decodeResource(lib.subarray(e.o,e.o+e.s)).data;
    const nd=Buffer.from(dec);let r=0;
    for(const sp of specs){const jpB=bf(Buffer.from(sp.jp,'hex')),cnB=bf(Buffer.from(sp.cn,'hex'));let idx=0;while((idx=nd.indexOf(jpB,idx))!==-1){cnB.copy(nd,idx);idx+=jpB.length;r++;}}
    if(r===0){outBuf=lib.subarray(e.o,e.o+e.s);intendedDecoded[e.n]=null;}
    else{
      const enc=compressMulti(nd,40000);
      const rt=decodeResource(enc).data;
      if(Buffer.compare(rt,nd)!==0){verifyFail++;console.log('ENC VERIFY FAIL',e.n);outBuf=lib.subarray(e.o,e.o+e.s);intendedDecoded[e.n]=null;}
      else{outBuf=enc;intendedDecoded[e.n]=nd;patched++;repls+=r;}
    }
  }
  hdr.writeUInt32LE(offset,e.ho+16);hdr.writeUInt32LE(outBuf.length,e.ho+20);
  chunks.push(Buffer.from(outBuf));offset+=outBuf.length;
}
const outLib=Buffer.concat(chunks);
fs.writeFileSync('/tmp/DAT1_NEW.HDR',hdr);
fs.writeFileSync('/tmp/DAT1_NEW.LIB',outLib);
console.log(`patched=${patched} repls=${repls} encVerifyFail=${verifyFail} newLib=${outLib.length} (orig ${lib.length})`);
// FINAL full verify: decode every resource from new lib; compare to intended (name-changed) or original
const nes=ph('/tmp/DAT1_NEW.HDR');const nl=fs.readFileSync('/tmp/DAT1_NEW.LIB');
const om={};for(const e of entries)om[e.n]=e;
let bad=0,checked=0;
for(const e of nes){
  let nd;try{nd=decodeResource(nl.subarray(e.o,e.o+e.s)).data;}catch(err){bad++;console.log('DECODE FAIL',e.n);continue;}
  checked++;
  const intended=intendedDecoded[e.n];
  if(intended){if(Buffer.compare(nd,intended)!==0){bad++;console.log('CONTENT MISMATCH(name)',e.n);}}
  else{const oe=om[e.n];const od=decodeResource(lib.subarray(oe.o,oe.o+oe.s)).data;if(Buffer.compare(nd,od)!==0){bad++;console.log('UNTOUCHED CHANGED',e.n);}}
}
console.log(`FINAL VERIFY: checked=${checked} bad=${bad}`);
