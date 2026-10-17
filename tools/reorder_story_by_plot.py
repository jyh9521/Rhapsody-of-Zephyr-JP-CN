#!/usr/bin/env python3
"""
Reorder _work/text/story_ac_bf.tsv into a best-effort reading order without
losing any data (rows are emitted verbatim; only their order changes).

Ordering key, per row:
  1. archive number from the id prefix (2 -> 3 -> 4). The three archives are
     chronological: DAT2 = chapters 0-5, DAT3 = 6-13, DAT4 = 13-28.
  2. numbered main-story stages (FLnn_Sxx) first, sorted by chapter nn then
     scene xx  -> the main plot reads top to bottom in order.
  3. then the named area/town/dungeon scenes (FLINF, FLDES, FLTRO, ...),
     grouped by their area code so each location's dialogue is contiguous.
  4. within a scene, original offset order (unchanged).

NOTE: the game has no stored scene-play-order table, so the exact insertion
point of a named area scene relative to the numbered stages cannot be derived
automatically.  The numbered spine is correct; named areas are grouped, not
plot-placed.  Import is keyed by `id`, so reordering never affects patching.

Output: _work/text/story_ac_bf.reordered.tsv  (same columns; review, then
replace story_ac_bf.tsv if you like it).
"""
import re, sys, os

SRC = os.path.join('_work','text','story_ac_bf.tsv')
OUT = os.path.join('_work','text','story_ac_bf.reordered.tsv')

def natscene(s):
    # split digits/letters for natural sort of scene suffix (S01, S2B, TE1, XX)
    return [(int(t) if t.isdigit() else t) for t in re.findall(r'\d+|\D+', s)]

def keyfor(idfield, source):
    m = re.match(r'\s*(\d+):', idfield)
    archive = int(m.group(1)) if m else 9
    mm = re.search(r'__([A-Za-z0-9_]+)\._AC', source) or re.search(r'([A-Za-z0-9_]+)\._AC', source)
    name = mm.group(1) if mm else idfield
    num = re.match(r'^FL(\d{2})_(.+)$', name)
    if num:
        return (archive, 0, int(num.group(1)), natscene(num.group(2)), name)
    # named area scene: area = leading letters after FL, keep whole name grouped
    area = re.match(r'^FL([A-Za-z]+)', name)
    return (archive, 1, area.group(1) if area else name, natscene(name), name)

def main():
    raw = open(SRC,'rb').read()
    nl = b'\r\n' if raw.count(b'\r\n')>raw.count(b'\n')/2 else b'\n'
    lines = raw.split(b'\n')
    # keep header line 0 verbatim
    header = lines[0]
    body = [l for l in lines[1:] if l.strip(b'\r')]
    def sortkey(lb):
        try:
            txt = lb.replace(b'\x00',b'').decode('utf-8','replace')
        except Exception:
            txt = ''
        cols = txt.split('\t')
        idf = cols[0] if cols else ''
        src = cols[1] if len(cols)>1 else ''
        return keyfor(idf, src)
    body_sorted = sorted(body, key=sortkey)
    out = header + b'\n' + b'\n'.join(body_sorted) + b'\n'
    open(OUT,'wb').write(out)
    print(f'wrote {OUT}  ({len(body_sorted)} rows)')

if __name__=='__main__':
    main()
