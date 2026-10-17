const fs = require("fs");

const outPath = process.argv[2] || "ZPGDI.dll";

const IMAGE_BASE = 0x62000000;
const SECTION_ALIGN = 0x1000;
const FILE_ALIGN = 0x200;
const TEXT_RVA = 0x1000;
const RDATA_RVA = 0x2000;

const exportNames = [
  "CreateCompatibleDC",
  "CreateDCA",
  "CreateDIBSection",
  "CreateFontA",
  "CreatePalette",
  "DeleteDC",
  "DeleteObject",
  "GetObjectA",
  "SelectObject",
  "SelectPalette",
  "SetBkMode",
  "SetTextColor",
  "StretchDIBits",
  "TextOutA",
].sort();

const gdiImports = [
  ...exportNames,
  "TextOutW",
].sort();

const kernelImports = ["MultiByteToWideChar"];

function align(value, boundary) {
  return (value + boundary - 1) & ~(boundary - 1);
}

function u16(value) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(value & 0xffff);
  return [...b];
}

function u32(value) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(value >>> 0);
  return [...b];
}

function setU32(bytes, off, value) {
  bytes[off] = value & 0xff;
  bytes[off + 1] = (value >>> 8) & 0xff;
  bytes[off + 2] = (value >>> 16) & 0xff;
  bytes[off + 3] = (value >>> 24) & 0xff;
}

class Code {
  constructor() {
    this.bytes = [];
    this.labels = new Map();
    this.absRefs = [];
    this.rel8 = [];
  }
  get pos() { return this.bytes.length; }
  mark(name) { this.labels.set(name, TEXT_RVA + this.pos); }
  emit(...items) { this.bytes.push(...items.flat()); }
  abs32(symbol) {
    this.absRefs.push({ off: this.pos, symbol });
    this.emit(0, 0, 0, 0);
  }
  jmpIat(symbol) {
    this.emit(0xff, 0x25);
    this.abs32(symbol);
  }
  callIat(symbol) {
    this.emit(0xff, 0x15);
    this.abs32(symbol);
  }
  pushAbs(symbol) {
    this.emit(0x68);
    this.abs32(symbol);
  }
  jcc8(op, label) {
    this.emit(op);
    this.rel8.push({ off: this.pos, label });
    this.emit(0);
  }
  jmp8(label) {
    this.emit(0xeb);
    this.rel8.push({ off: this.pos, label });
    this.emit(0);
  }
  resolveRel8() {
    for (const jump of this.rel8) {
      const targetRva = this.labels.get(jump.label);
      if (targetRva == null) throw new Error(`Unresolved jump label: ${jump.label}`);
      const targetOff = targetRva - TEXT_RVA;
      const rel = targetOff - (jump.off + 1);
      if (rel < -128 || rel > 127) {
        throw new Error(`rel8 out of range to ${jump.label}: ${rel}`);
      }
      this.bytes[jump.off] = rel & 0xff;
    }
  }
}

function buildCode() {
  const c = new Code();

  c.mark("DllMain");
  c.emit(0xb8, 0x01, 0x00, 0x00, 0x00); // mov eax,1
  c.emit(0xc2, 0x0c, 0x00); // ret 0Ch

  for (const name of exportNames) {
    if (name === "TextOutA" || name === "CreateFontA") continue;
    c.mark(name);
    c.jmpIat(`iat:gdi32:${name}`);
  }

  c.mark("TextOutA");
  c.emit(0x55, 0x8b, 0xec, 0x83, 0xec, 0x50); // frame
  c.emit(0x53, 0x56, 0x57); // preserve ebx,esi,edi
  c.emit(0x8b, 0x75, 0x14); // esi = lpString
  c.emit(0x8b, 0x4d, 0x18); // ecx = cchString
  c.emit(0x85, 0xf6); // test esi,esi
  c.jcc8(0x74, "TextOutA.fallback"); // je
  c.emit(0x83, 0xf9, 0x02); // cmp ecx,2
  c.jcc8(0x75, "TextOutA.fallback"); // jne
  c.emit(0x0f, 0xb6, 0x16); // movzx edx,byte [esi]
  c.emit(0x80, 0xfa, 0x81); // cmp dl,81h
  c.jcc8(0x72, "TextOutA.fallback"); // jb
  c.emit(0x80, 0xfa, 0xfe); // cmp dl,0FEh
  c.jcc8(0x77, "TextOutA.fallback"); // ja
  c.emit(0x66, 0x8b, 0x06); // mov ax,[esi]
  c.emit(0x66, 0x89, 0x45, 0xfc); // local bytes
  c.emit(0x66, 0xc7, 0x45, 0xfe, 0x00, 0x00);

  c.emit(0x6a, 0x10); // cchWideChar
  c.emit(0x8d, 0x45, 0xc0, 0x50); // wide buffer
  c.emit(0x6a, 0x02); // cbMultiByte
  c.emit(0x8d, 0x45, 0xfc, 0x50); // local bytes
  c.emit(0x6a, 0x00); // flags
  c.emit(0x68, ...u32(936)); // CP936
  c.callIat("iat:kernel32:MultiByteToWideChar");
  c.emit(0x85, 0xc0); // test eax,eax
  c.jcc8(0x7e, "TextOutA.fallback"); // jle
  c.emit(0x50); // cchString
  c.emit(0x8d, 0x4d, 0xc0, 0x51); // lpString
  c.emit(0xff, 0x75, 0x10); // y
  c.emit(0xff, 0x75, 0x0c); // x
  c.emit(0xff, 0x75, 0x08); // hdc
  c.callIat("iat:gdi32:TextOutW");
  c.jmp8("TextOutA.done");

  c.mark("TextOutA.fallback");
  c.emit(0xff, 0x75, 0x18);
  c.emit(0xff, 0x75, 0x14);
  c.emit(0xff, 0x75, 0x10);
  c.emit(0xff, 0x75, 0x0c);
  c.emit(0xff, 0x75, 0x08);
  c.callIat("iat:gdi32:TextOutA");

  c.mark("TextOutA.done");
  c.emit(0x5f, 0x5e, 0x5b);
  c.emit(0x8b, 0xe5, 0x5d, 0xc2, 0x14, 0x00);

  c.mark("CreateFontA");
  c.emit(0x55, 0x8b, 0xec);
  c.pushAbs("str:simsun"); // pszFaceName
  c.emit(0xff, 0x75, 0x38); // iPitchAndFamily
  c.emit(0xff, 0x75, 0x34); // iQuality
  c.emit(0xff, 0x75, 0x30); // iClipPrecision
  c.emit(0xff, 0x75, 0x2c); // iOutPrecision
  c.emit(0x68, 0x86, 0x00, 0x00, 0x00); // GB2312_CHARSET
  c.emit(0xff, 0x75, 0x24); // cStrikeOut
  c.emit(0xff, 0x75, 0x20); // cUnderline
  c.emit(0xff, 0x75, 0x1c); // cItalic
  c.emit(0xff, 0x75, 0x18); // cWeight
  c.emit(0xff, 0x75, 0x14); // cOrientation
  c.emit(0xff, 0x75, 0x10); // cEscapement
  c.emit(0xff, 0x75, 0x0c); // cWidth
  c.emit(0xff, 0x75, 0x08); // cHeight
  c.callIat("iat:gdi32:CreateFontA");
  c.emit(0x8b, 0xe5, 0x5d, 0xc2, 0x38, 0x00);

  c.resolveRel8();
  return c;
}

class Data {
  constructor() {
    this.bytes = [];
    this.symbols = new Map();
    this.patches = [];
  }
  get pos() { return this.bytes.length; }
  rva() { return RDATA_RVA + this.pos; }
  mark(name) { this.symbols.set(name, this.rva()); }
  emit(...items) { this.bytes.push(...items.flat()); }
  align(n) { while (this.bytes.length % n) this.bytes.push(0); }
  str(symbol, value) {
    this.mark(symbol);
    this.emit(...Buffer.from(value + "\0", "ascii"));
  }
  u16(value) { this.emit(...u16(value)); }
  u32(value) { this.emit(...u32(value)); }
  reserve(size) {
    const off = this.pos;
    for (let i = 0; i < size; i++) this.bytes.push(0);
    return off;
  }
  setU32(off, value) { setU32(this.bytes, off, value); }
}

function buildImports(d) {
  const dlls = [
    { name: "GDI32.dll", funcs: gdiImports, prefix: "gdi32" },
    { name: "KERNEL32.dll", funcs: kernelImports, prefix: "kernel32" },
  ];

  d.align(4);
  const importDirRva = d.rva();
  const descOff = d.reserve((dlls.length + 1) * 20);
  let iatStart = 0;
  let iatEnd = 0;

  for (let i = 0; i < dlls.length; i++) {
    const dll = dlls[i];
    d.str(`import_name:${dll.name}`, dll.name);
    const nameRvas = [];
    for (const fn of dll.funcs) {
      d.align(2);
      const rva = d.rva();
      d.u16(0);
      d.emit(...Buffer.from(fn + "\0", "ascii"));
      nameRvas.push({ fn, rva });
    }

    d.align(4);
    const intRva = d.rva();
    for (const row of nameRvas) d.u32(row.rva);
    d.u32(0);

    d.align(4);
    const iatRva = d.rva();
    if (!iatStart) iatStart = iatRva;
    for (const row of nameRvas) {
      d.symbols.set(`iat:${dll.prefix}:${row.fn}`, d.rva());
      d.u32(row.rva);
    }
    d.u32(0);
    iatEnd = d.rva();

    const off = descOff + i * 20;
    d.setU32(off + 0, intRva);
    d.setU32(off + 12, d.symbols.get(`import_name:${dll.name}`));
    d.setU32(off + 16, iatRva);
  }

  return { importDirRva, importSize: (dlls.length + 1) * 20, iatStart, iatSize: iatEnd - iatStart };
}

function buildExports(d, codeLabels) {
  d.align(4);
  const exportDirRva = d.rva();
  const dirOff = d.reserve(40);

  d.str("str:exportDllName", "ZPGDI.dll");
  d.str("str:simsun", "SimSun");

  d.align(4);
  const eatRva = d.rva();
  for (const name of exportNames) d.u32(codeLabels.get(name));

  d.align(4);
  const namesRva = d.rva();
  const namePatchOffs = [];
  for (const name of exportNames) {
    namePatchOffs.push(d.pos);
    d.u32(0);
  }

  d.align(2);
  const ordinalsRva = d.rva();
  for (let i = 0; i < exportNames.length; i++) d.u16(i);

  for (let i = 0; i < exportNames.length; i++) {
    const symbol = `str:export:${exportNames[i]}`;
    d.str(symbol, exportNames[i]);
    d.setU32(namePatchOffs[i], d.symbols.get(symbol));
  }

  d.setU32(dirOff + 12, d.symbols.get("str:exportDllName"));
  d.setU32(dirOff + 16, 1); // ordinal base
  d.setU32(dirOff + 20, exportNames.length);
  d.setU32(dirOff + 24, exportNames.length);
  d.setU32(dirOff + 28, eatRva);
  d.setU32(dirOff + 32, namesRva);
  d.setU32(dirOff + 36, ordinalsRva);

  const exportEndRva = d.rva();
  return { exportDirRva, exportSize: exportEndRva - exportDirRva };
}

function buildRelocBlob(relocRvas) {
  const groups = new Map();
  for (const rva of relocRvas) {
    const page = rva & ~0xfff;
    const off = rva & 0xfff;
    if (!groups.has(page)) groups.set(page, []);
    groups.get(page).push(0x3000 | off);
  }

  const out = [];
  for (const page of [...groups.keys()].sort((a, b) => a - b)) {
    const entries = [...new Set(groups.get(page))].sort((a, b) => a - b);
    if (entries.length % 2) entries.push(0);
    out.push(...u32(page), ...u32(8 + entries.length * 2));
    for (const entry of entries) out.push(...u16(entry));
  }
  return Buffer.from(out);
}

function writeHeaders(text, rdata, dirs) {
  const textRawSize = align(text.length, FILE_ALIGN);
  const rdataRawSize = align(rdata.length, FILE_ALIGN);
  const textRaw = 0x200;
  const rdataRaw = textRaw + textRawSize;
  const sizeOfImage = align(RDATA_RVA + rdata.length, SECTION_ALIGN);

  const headers = Buffer.alloc(0x200);
  headers.writeUInt16LE(0x5a4d, 0); // MZ
  headers.writeUInt32LE(0x80, 0x3c);
  headers.write("PE\0\0", 0x80, "ascii");
  const coff = 0x84;
  headers.writeUInt16LE(0x14c, coff); // i386
  headers.writeUInt16LE(2, coff + 2);
  headers.writeUInt32LE(Math.floor(Date.now() / 1000), coff + 4);
  headers.writeUInt16LE(0xe0, coff + 16);
  headers.writeUInt16LE(0x210e, coff + 18);

  const opt = coff + 20;
  headers.writeUInt16LE(0x10b, opt);
  headers.writeUInt32LE(textRawSize, opt + 4);
  headers.writeUInt32LE(rdataRawSize, opt + 8);
  headers.writeUInt32LE(TEXT_RVA, opt + 16 + 4); // BaseOfCode at +20
  headers.writeUInt32LE(RDATA_RVA, opt + 24); // BaseOfData
  headers.writeUInt32LE(IMAGE_BASE, opt + 28);
  headers.writeUInt32LE(SECTION_ALIGN, opt + 32);
  headers.writeUInt32LE(FILE_ALIGN, opt + 36);
  headers.writeUInt16LE(4, opt + 40);
  headers.writeUInt16LE(0, opt + 42);
  headers.writeUInt16LE(4, opt + 48);
  headers.writeUInt16LE(0, opt + 50);
  headers.writeUInt32LE(dirs.entryPoint, opt + 16);
  headers.writeUInt32LE(sizeOfImage, opt + 56);
  headers.writeUInt32LE(0x200, opt + 60);
  headers.writeUInt16LE(2, opt + 68); // GUI
  headers.writeUInt16LE(0, opt + 70);
  headers.writeUInt32LE(0x100000, opt + 72);
  headers.writeUInt32LE(0x1000, opt + 76);
  headers.writeUInt32LE(0x100000, opt + 80);
  headers.writeUInt32LE(0x1000, opt + 84);
  headers.writeUInt32LE(16, opt + 92);

  const dd = opt + 96;
  headers.writeUInt32LE(dirs.exportRva, dd + 0 * 8);
  headers.writeUInt32LE(dirs.exportSize, dd + 0 * 8 + 4);
  headers.writeUInt32LE(dirs.importRva, dd + 1 * 8);
  headers.writeUInt32LE(dirs.importSize, dd + 1 * 8 + 4);
  headers.writeUInt32LE(dirs.relocRva, dd + 5 * 8);
  headers.writeUInt32LE(dirs.relocSize, dd + 5 * 8 + 4);
  headers.writeUInt32LE(dirs.iatRva, dd + 12 * 8);
  headers.writeUInt32LE(dirs.iatSize, dd + 12 * 8 + 4);

  const sh = opt + 0xe0;
  function section(off, name, virtSize, rva, rawSize, rawPtr, chars) {
    headers.write(name, off, "ascii");
    headers.writeUInt32LE(virtSize, off + 8);
    headers.writeUInt32LE(rva, off + 12);
    headers.writeUInt32LE(rawSize, off + 16);
    headers.writeUInt32LE(rawPtr, off + 20);
    headers.writeUInt32LE(chars, off + 36);
  }
  section(sh, ".text\0\0\0", text.length, TEXT_RVA, textRawSize, textRaw, 0x60000020);
  section(sh + 40, ".rdata\0\0", rdata.length, RDATA_RVA, rdataRawSize, rdataRaw, 0xc0000040);

  return { headers, textRawSize, rdataRawSize, textRaw, rdataRaw };
}

function main() {
  const code = buildCode();
  const d = new Data();
  const exportInfo = buildExports(d, code.labels);
  const importInfo = buildImports(d);

  const symbols = new Map([...code.labels, ...d.symbols]);
  const relocRvas = [];
  for (const ref of code.absRefs) {
    const rva = symbols.get(ref.symbol);
    if (rva == null) throw new Error(`Unresolved symbol: ${ref.symbol}`);
    setU32(code.bytes, ref.off, IMAGE_BASE + rva);
    relocRvas.push(TEXT_RVA + ref.off);
  }

  d.align(4);
  const relocRva = d.rva();
  const relocBlob = buildRelocBlob(relocRvas);
  d.emit(...relocBlob);

  const text = Buffer.from(code.bytes);
  const rdata = Buffer.from(d.bytes);
  const dirs = {
    entryPoint: code.labels.get("DllMain"),
    exportRva: exportInfo.exportDirRva,
    exportSize: exportInfo.exportSize,
    importRva: importInfo.importDirRva,
    importSize: importInfo.importSize,
    iatRva: importInfo.iatStart,
    iatSize: importInfo.iatSize,
    relocRva,
    relocSize: relocBlob.length,
  };
  const h = writeHeaders(text, rdata, dirs);
  const out = Buffer.alloc(h.rdataRaw + h.rdataRawSize);
  h.headers.copy(out, 0);
  text.copy(out, h.textRaw);
  rdata.copy(out, h.rdataRaw);
  fs.writeFileSync(outPath, out);

  console.log(`Wrote ${outPath}`);
  console.log(`exports=${exportNames.length}, imports=${gdiImports.length + kernelImports.length}`);
  console.log(`text=${text.length}, rdata=${rdata.length}, relocs=${relocRvas.length}`);
}

main();
