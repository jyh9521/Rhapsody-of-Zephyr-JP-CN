// 带溯源的 type0/packed 解码: 记录每个输出字节来自 raw 的哪个字节(仅literal), 或是copy
const fs=require('fs');
class BitReader{constructor(buf,offset){this.buf=buf;this.offset=offset+2;this.bitsLeft=8;this.bits=buf[offset+1]||0;}
 bit(){if(this.bitsLeft===0){this.bits=(this.buf[this.offset]||0)|((this.buf[this.offset+1]||0)<<8);this.offset+=2;this.bitsLeft=16;}const b=this.bits&1;this.bits>>>=1;this.bitsLeft--;return b;}
 bitsValue(c){let v=0;for(let i=0;i<c;i++)v=(v<<1)|this.bit();return v;}
 byteAt(){return this.offset;} byte(){return this.buf[this.offset++]||0;}}
function copyLen(r){if(r.bit())return 2;if(r.bit())return 3;if(r.bit())return 4;if(r.bit())return 5;if(!r.bit())return r.byte()+14;return r.bitsValue(3)+6;}
// out: array; prov: array 同长, 每项 {lit:true,raw:offset} 或 {lit:false}
function decodeType0(buf,offset,blockLength,out,prov){
 const blockEnd=offset-2+blockLength;const r=new BitReader(buf,offset);
 while(r.offset<blockEnd){
  if(!r.bit()){const ro=r.byteAt();out.push(r.byte());prov.push({lit:true,raw:ro});continue;}
  if(!r.bit()){const dist=r.byte();const L=copyLen(r);const s=out.length-dist;for(let i=0;i<L;i++){out.push(s+i<0?0:out[s+i]);prov.push({lit:false});}continue;}
  const dc=(r.bitsValue(5)<<8)|r.byte();
  if(dc>0){if(dc>1){const L=copyLen(r);const s=out.length-dc;for(let i=0;i<L;i++){out.push(s+i<0?0:out[s+i]);prov.push({lit:false});}continue;}
   const rl=(r.bit()?((r.bitsValue(4)<<8)|r.byte()):r.bitsValue(4))+14;const v=r.byte();for(let i=0;i<rl;i++){out.push(v);prov.push({lit:false});}continue;}
  return r.offset;}
 return blockEnd;}
function decodePacked(buf,offset,blockLength,out,prov){
 let consumed=2;
 while(consumed!==blockLength){const cmd=buf[offset++]||0;consumed++;
  if(cmd&0x80){let dist=((cmd&0x1f)<<8)|(buf[offset++]||0);let L=((cmd>>>5)&3)+4;consumed++;
   while(consumed!==blockLength&&(buf[offset]&0xe0)===0x60){L+=buf[offset]&0x1f;offset++;consumed++;}
   const s=out.length-dist;for(let i=0;i<L;i++){out.push(s+i<0?0:out[s+i]);prov.push({lit:false});}continue;}
  if(cmd&0x40){let L;if(cmd&0x10){L=(((cmd&0x0f)<<8)|(buf[offset++]||0))+4;consumed++;}else L=(cmd&0x0f)+4;const v=buf[offset++]||0;consumed++;for(let i=0;i<L;i++){out.push(v);prov.push({lit:false});}continue;}
  let L=cmd&0x1f;if(cmd&0x20){L=(L<<8)|(buf[offset++]||0);consumed++;}
  for(let i=0;i<L;i++){const ro=offset;out.push(buf[offset++]||0);prov.push({lit:true,raw:ro});}consumed+=L;}
 return offset;}
function decodeProv(buf){let offset=0;const out=[],prov=[];
 while(offset+3<=buf.length){const blockLength=buf.readUInt16LE(offset);offset+=2;const bt=buf[offset];
  if(bt===0)offset=decodeType0(buf,offset,blockLength,out,prov);else offset=decodePacked(buf,offset,blockLength,out,prov);
  const cont=buf[offset++];if(cont===0)break;}
 return {data:Buffer.from(out),prov};}
module.exports={decodeProv};
