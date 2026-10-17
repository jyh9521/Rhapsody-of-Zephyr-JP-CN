#!/usr/bin/env python3
"""
Patch translated UI/system strings from _work/text/exe_strings_to_translate.tsv
into zephyr.exe IN PLACE.

- Reads column cn_text; rows with empty cn_text are left as original Japanese.
- Each CN string is CP936/GBK-encoded and must fit within the slot's byte
  capacity (bytes up to the original NUL terminator). Longer rows are skipped
  and listed so the translator can shorten them; the exe is never grown or
  offsets moved.
- Escapes: literal "\\n"/"\\r"/"\\t" in the TSV are real control bytes; the
  game's own line-break token "/n" is left verbatim. Katakana middle dot
  U+30FB is normalised to U+00B7 (GBK middle dot).
- Backs up zephyr.exe before writing.
Usage:  python tools/apply_exe_cn_strings.py [--exe zephyr.exe]
"""
import csv, datetime, shutil, sys, os

TSV = os.path.join('_work','text','exe_strings_to_translate.tsv')

def unescape(s):
    return s.replace('\\r\\n','\r\n').replace('\\n','\n').replace('\\r','\r').replace('\\t','\t')
def norm(s):
    return s.replace('・','·')

# Offsets that are INTERNAL sprite/animation/battle-state keys, matched by the
# engine (strcmp) against sprite resource names. Translating them breaks the
# character sprites (e.g. only the back-facing frame shows). NEVER patch these.
SKIP_OFFSETS = {
    # field movement direction keys: 歩き/基本待機/走り x L,D,R,U
    0x08e45c,0x08e464,0x08e46c,0x08e474,
    0x08e47c,0x08e488,0x08e494,0x08e4a0,
    0x08e4ac,0x08e4b4,0x08e4bc,0x08e4c4,
    # battle animation states / action keys
    0x08ef04,0x08ef10,0x08ef1c,0x08ef70,0x08ef98,0x08efd0,0x08f038,
    0x08f094,0x08f0f0,0x08f178,0x08f1b4,0x08f22c,
    0x08f6c8,0x08f6d4,0x08f6dc,0x08f6e8,0x08f6f4,
    # weapon/attach slots + dash key
    0x0905ec,0x0905f6,0x090600,0x09060a,0x090cb0,
    # battle pose / evade animation states
    0x09255c,0x0925c4,
}

# World-map/select-map location nameplates also participate in save/map
# initialization. Rewriting the wider table causes save-load crashes even when
# the 18-byte records are space-padded correctly, so leave this table to the
# renderer/runtime layer instead of patching the exe bytes.
DANGEROUS_MAP_NAME_OFFSETS = set(range(0x094db8, 0x095148, 0x13))

def main():
    exe_path='zephyr.exe'
    if '--exe' in sys.argv:
        exe_path=sys.argv[sys.argv.index('--exe')+1]
    exe=bytearray(open(exe_path,'rb').read())

    def cap_at(off):
        j=off
        while j<len(exe) and exe[j]!=0 and j-off<400: j+=1
        return j-off

    def try_fit(cn2,cap):
        b=cn2.encode('cp936')
        if len(b)<=cap: return b,False
        if cn2.endswith(']'):
            core=cn2[:-1]
            while core.endswith(' ') and len(core.encode('cp936'))+1>cap:
                core=core[:-1]
            cand=core+']'
            if len(cand.encode('cp936'))<=cap: return cand.encode('cp936'),True
        t=cn2
        while t.endswith(' ') and len(t.encode('cp936'))>cap:
            t=t[:-1]
        if len(t.encode('cp936'))<=cap: return t.encode('cp936'),True
        return None,False

    rows=list(csv.DictReader(open(TSV,encoding='utf-8-sig'),delimiter='\t'))
    applied=0; over=[]; err=[]; trimmed=0
    stamp=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    shutil.copy2(exe_path, f'{exe_path}.bak_before_exe_cn_{stamp}')

    skipped_keys=0
    for r in rows:
        cn=(r.get('cn_text') or '').strip()
        if not cn: continue
        off=int(r['offset_hex'],16)
        if off in DANGEROUS_MAP_NAME_OFFSETS:
            skipped_keys+=1; continue
        if off in SKIP_OFFSETS:
            skipped_keys+=1; continue
        cn2=norm(unescape(cn))
        try: cn2.encode('cp936')
        except Exception as e: err.append((off,cn,str(e))); continue
        cap=cap_at(off)
        if cap==0 or cap>=400: err.append((off,cn,f'bad cap {cap}')); continue
        res,was_trim=try_fit(cn2,cap)
        if res is None:
            over.append((off,cn,len(cn2.encode('cp936')),cap)); continue
        exe[off:off+len(res)]=res
        for k in range(off+len(res),off+cap): exe[k]=0
        applied+=1; trimmed+=1 if was_trim else 0

    open(exe_path,'wb').write(exe)
    print(f'backup: {exe_path}.bak_before_exe_cn_{stamp}')
    print(f'applied={applied} sprite_keys_skipped={skipped_keys} overflow_skipped={len(over)} errors={len(err)} auto_trimmed={trimmed}')
    # write overflow report
    rep=os.path.join('_work','text','exe_strings_overflow.tsv')
    with open(rep,'w',encoding='utf-8-sig',newline='') as f:
        w=csv.writer(f,delimiter='\t'); w.writerow(['offset_hex','need_bytes','cap_bytes','cn_text'])
        for off,cn,need,cap in over: w.writerow([f'0x{off:06x}',need,cap,cn])
    if over:
        print(f'overflow rows written to {rep} (shorten cn_text and re-run):')
        for off,cn,need,cap in over: print(f'  0x{off:06x} need={need} cap={cap} {cn}')
    for off,cn,e in err: print(f'  ERR 0x{off:06x} {cn} :: {e}')

if __name__=='__main__':
    main()
