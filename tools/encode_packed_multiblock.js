class BitWriter{constructor(){this.out=[0x00,0x00];this.flagPos=1;this.cap=8;this.bitsUsed=0;}
 writeBit(b){if(this.bitsUsed===this.cap){this.flagPos=this.out.length;this.out.push(0,0);this.cap=16;this.bitsUsed=0;}if(b){const bit=this.bitsUsed;if(this.cap===8)this.out[this.flagPos]|=(1<<bit);else if(bit<8)this.out[this.flagPos]|=(1<<bit);else this.out[this.flagPos+1]|=(1<<(bit-8));}this.bitsUsed++;}
 writeByte(v){this.out.push(v&0xff);} writeBits(v,n){for(let i=n-1;i>=0;i--)this.writeBit((v>>i)&1);}}
function writeLen(w,len){if(len===2){w.writeBit(1);return;}if(len===3){w.writeBit(0);w.writeBit(1);return;}if(len===4){w.writeBit(0);w.writeBit(0);w.writeBit(1);return;}if(len===5){w.writeBit(0);w.writeBit(0);w.writeBit(0);w.writeBit(1);return;}w.writeBit(0);w.writeBit(0);w.writeBit(0);w.writeBit(0);if(len<=13){w.writeBit(1);w.writeBits(len-6,3);return;}w.writeBit(0);w.writeByte(len-14);}
const MAXLEN=269,MAXDIST=8191;
// multi-block: global window (continuous output), cut blocks by input chunk. Each block: [u16 blockLen][type0][flags...tokens...][end-marker], followed by continuation byte.
function compressMulti(data,chunk){
  const n=data.length;const head={},prev=new Int32Array(n).fill(-1);
  const key=i=>data[i]|(data[i+1]<<8);const insert=p=>{if(p+1<n){const k=key(p);prev[p]=head[k]??-1;head[k]=p;}};
  const blocks=[];let i=0;
  while(i<n){
    const blockStart=i;const limit=Math.min(n,blockStart+chunk);
    const w=new BitWriter();
    while(i<limit){
      let bestLen=0,bestDist=0;
      if(i+1<n){let cand=head[key(i)]??-1,tries=0;while(cand>=0&&i-cand<=MAXDIST&&tries<256){const dist=i-cand;let l=0;const max=Math.min(MAXLEN,n-i);while(l<max&&data[cand+l]===data[i+l])l++;if(l>bestLen||(l===bestLen&&dist<bestDist)){bestLen=l;bestDist=dist;}cand=prev[cand];tries++;}}
      // don't let a match cross the block limit end (keep decode per-block bounded)
      if(bestLen>0&&i+bestLen>limit&&limit<n)bestLen=Math.min(bestLen,limit-i);
      const ok=bestLen>=2&&(bestDist<=255||bestLen>=3)&&bestDist>=1;
      if(ok){if(bestDist<=255){w.writeBit(1);w.writeBit(0);w.writeByte(bestDist);writeLen(w,bestLen);}else{w.writeBit(1);w.writeBit(1);w.writeBits(bestDist>>8,5);w.writeByte(bestDist&0xff);writeLen(w,bestLen);}for(let k=0;k<bestLen;k++)insert(i+k);i+=bestLen;}
      else{w.writeBit(0);w.writeByte(data[i]);insert(i);i++;}
      if(w.out.length>60000&&i<limit){/* safety cut */break;}
    }
    // end-marker for this block
    w.writeBit(1);w.writeBit(1);w.writeBits(0,5);w.writeByte(0);
    blocks.push(Buffer.from(w.out));
  }
  // assemble
  const parts=[];
  for(let b=0;b<blocks.length;b++){
    const stream=blocks[b];const blockLength=stream.length+2;
    if(blockLength>0xffff)throw new Error('block too big '+blockLength);
    const hdr=Buffer.alloc(2);hdr.writeUInt16LE(blockLength,0);
    parts.push(hdr,stream,Buffer.from([b===blocks.length-1?0:1]));
  }
  return Buffer.concat(parts);
}
module.exports={compressMulti};
