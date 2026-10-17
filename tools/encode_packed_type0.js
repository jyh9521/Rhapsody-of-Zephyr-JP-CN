const fs=require('fs');
const {decodeResource}=require('/sessions/nifty-adoring-ramanujan/mnt/ZEP_WIN/tools/zep_decode.js');
class BitWriter{
  constructor(){this.out=[0x00,0x00];this.flagPos=1;this.cap=8;this.bitsUsed=0;}
  writeBit(b){
    if(this.bitsUsed===this.cap){this.flagPos=this.out.length;this.out.push(0,0);this.cap=16;this.bitsUsed=0;}
    if(b){const bit=this.bitsUsed;
      if(this.cap===8)this.out[this.flagPos]|=(1<<bit);
      else if(bit<8)this.out[this.flagPos]|=(1<<bit);
      else this.out[this.flagPos+1]|=(1<<(bit-8));}
    this.bitsUsed++;
  }
  writeByte(v){this.out.push(v&0xff);}
  writeBits(v,n){for(let i=n-1;i>=0;i--)this.writeBit((v>>i)&1);}
}
function writeLen(w,len){
  if(len===2){w.writeBit(1);return;}
  if(len===3){w.writeBit(0);w.writeBit(1);return;}
  if(len===4){w.writeBit(0);w.writeBit(0);w.writeBit(1);return;}
  if(len===5){w.writeBit(0);w.writeBit(0);w.writeBit(0);w.writeBit(1);return;}
  w.writeBit(0);w.writeBit(0);w.writeBit(0);w.writeBit(0);
  if(len<=13){w.writeBit(1);w.writeBits(len-6,3);return;}
  w.writeBit(0);w.writeByte(len-14);
}
const MAXLEN=269,MAXDIST=8191;
function compress(data){
  const w=new BitWriter();
  const n=data.length;const head={},prev=new Int32Array(n).fill(-1);
  const key=i=>data[i]|(data[i+1]<<8);
  const insert=p=>{if(p+1<n){const k=key(p);prev[p]=head[k]??-1;head[k]=p;}};
  let i=0;
  while(i<n){
    let bestLen=0,bestDist=0;
    if(i+1<n){let cand=head[key(i)]??-1,tries=0;
      while(cand>=0&&i-cand<=MAXDIST&&tries<128){
        const dist=i-cand;let l=0;const max=Math.min(MAXLEN,n-i);
        while(l<max&&data[cand+l]===data[i+l])l++;
        if(l>bestLen||(l===bestLen&&dist<bestDist)){bestLen=l;bestDist=dist;}
        cand=prev[cand];tries++;}}
    const ok=bestLen>=2&&(bestDist<=255||bestLen>=3)&&bestDist>=1;
    if(ok){
      if(bestDist<=255){w.writeBit(1);w.writeBit(0);w.writeByte(bestDist);writeLen(w,bestLen);}
      else{w.writeBit(1);w.writeBit(1);w.writeBits(bestDist>>8,5);w.writeByte(bestDist&0xff);writeLen(w,bestLen);}
      for(let k=0;k<bestLen;k++)insert(i+k);i+=bestLen;
    }else{w.writeBit(0);w.writeByte(data[i]);insert(i);i++;}
  }
  // END MARKER (present in all 624 original resources): flags 1,1 + 5-bit 0 + byte 0
  w.writeBit(1);w.writeBit(1);w.writeBits(0,5);w.writeByte(0);
  const stream=Buffer.from(w.out);
  const blockLength=stream.length+2;
  if(blockLength>0xffff)throw new Error('block too big');
  const res=Buffer.alloc(2+stream.length+1);
  res.writeUInt16LE(blockLength,0);stream.copy(res,2);res[res.length-1]=0;
  return res;
}
// marker-driven decoder simulation (ignores blockLength) to prove termination
function markerDecode(buf){
  const r={buf,offset:4,bitsLeft:8,bits:buf[3]||0,
    bit(){if(this.bitsLeft===0){this.bits=(this.buf[this.offset]||0)|((this.buf[this.offset+1]||0)<<8);this.offset+=2;this.bitsLeft=16;}const b=this.bits&1;this.bits>>>=1;this.bitsLeft--;return b;}};
  const byte=()=>buf[r.offset++]||0;
  const bits=n=>{let v=0;for(let k=0;k<n;k++)v=(v<<1)|r.bit();return v;};
  const clen=()=>{if(r.bit())return 2;if(r.bit())return 3;if(r.bit())return 4;if(r.bit())return 5;if(!r.bit())return byte()+14;return bits(3)+6;};
  const out=[];
  for(;;){
    if(r.offset>buf.length)return {out:null,err:'overrun'};
    if(!r.bit()){out.push(byte());continue;}
    if(!r.bit()){const d=byte();const l=clen();for(let k=0;k<l;k++)out.push(out[out.length-d]??0);continue;}
    const doc=(bits(5)<<8)|byte();
    if(doc===0)return {out:Buffer.from(out),stopAt:r.offset};
    if(doc===1){const rl=(r.bit()?((bits(4)<<8)|byte()):bits(4))+14;const v=byte();for(let k=0;k<rl;k++)out.push(v);continue;}
    const l=clen();for(let k=0;k<l;k++)out.push(out[out.length-doc]??0);
  }
}
for(const name of ['3_FLTFA01._AC','3_FLTFA01_._AC']){
  const dec=fs.readFileSync(`/tmp/cn_${name}.bin`);
  const enc=compress(dec);
  const rt=decodeResource(enc);
  const same=Buffer.compare(rt.data,dec)===0;
  const md=markerDecode(enc);
  const mdOK=md.out&&Buffer.compare(md.out,dec)===0;
  console.log(`${name}: enc=${enc.length} lengthDecode=${same?'OK':'FAIL'} markerDecode=${mdOK?'OK':'FAIL'} stopAt=${md.stopAt} (streamEnd=${enc.length-1}) blocks=${JSON.stringify(rt.blocks)}`);
  if(same&&mdOK)fs.writeFileSync(`/tmp/enc2_${name}`,enc);
}
