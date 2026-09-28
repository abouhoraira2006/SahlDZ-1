// Fails loudly if a binary hard-imports an API that does not exist on the
// oldest supported Windows (Win7 SP1).  A hard import means the Windows loader
// aborts with "Point d'entrée de procédure ... introuvable dans KERNEL32.dll"
// before the app can even show a window.
const fs = require("fs");
const path = require("path");

// Introduced in Windows 10 1803 / Server 2019 -> absent on Win7, 8, 8.1 and
// early Win10.  Chromium only hard-imports these from Electron 23 onwards.
const WIN10_ONLY = new Set([
  "DiscardVirtualMemory",
  "SetProcessValidCallTargets",
  "SetProcessUserModeTarget",
]);

function parse(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString("ascii", 0, 2) !== "MZ") return null;
  const pe = buf.readUInt32LE(0x3c);
  if (buf.toString("ascii", pe, pe + 4) !== "PE\0\0") return null;

  const nSections = buf.readUInt16LE(pe + 6);
  const optSize = buf.readUInt16LE(pe + 20);
  const opt = pe + 24;
  const pe32plus = buf.readUInt16LE(opt) === 0x20b;
  const ddOff = opt + (pe32plus ? 112 : 96);
  const dirCount = buf.readUInt32LE(opt + (pe32plus ? 108 : 92));
  const secOff = opt + optSize;

  const secs = [];
  for (let i = 0; i < nSections; i++) {
    const s = secOff + i * 40;
    secs.push({
      vaddr: buf.readUInt32LE(s + 12),
      vsize: buf.readUInt32LE(s + 8),
      rawPtr: buf.readUInt32LE(s + 20),
      rawSize: buf.readUInt32LE(s + 16),
    });
  }
  const rvaToOff = (rva) => {
    for (const s of secs)
      if (rva >= s.vaddr && rva < s.vaddr + Math.max(s.vsize, s.rawSize))
        return s.rawPtr + (rva - s.vaddr);
    return null;
  };
  const cstr = (o) => {
    let e = o;
    while (e < buf.length && buf[e] !== 0) e++;
    return buf.toString("ascii", o, e);
  };
  const step = pe32plus ? 8 : 4;

  const hardImports = [];
  for (const [idx, isDelay] of [[1, false], [13, true]]) {
    if (idx >= dirCount) continue;
    const rva = buf.readUInt32LE(ddOff + idx * 8);
    if (!rva) continue;
    let off = rvaToOff(rva);
    if (off === null) continue;
    const dStep = isDelay ? 32 : 20;
    for (let n = 0; off && n < 4096; n++, off += dStep) {
      if (off + 32 > buf.length) break;
      const zs = isDelay ? [0, 4, 8, 12, 16, 20, 24, 28] : [0, 4, 8, 12, 16];
      if (zs.every((o) => buf.readUInt32LE(off + o) === 0)) break;
      const no = rvaToOff(buf.readUInt32LE(off + 12));
      if (no === null) continue;
      const dll = cstr(no);
      if (!/KERNEL32/i.test(dll)) continue;
      for (const tr of [
        isDelay ? buf.readUInt32LE(off + 16) : buf.readUInt32LE(off),
        isDelay ? buf.readUInt32LE(off + 20) : buf.readUInt32LE(off + 16),
      ]) {
        if (!tr) continue;
        let to = rvaToOff(tr);
        if (to === null) continue;
        for (let i = 0; i < 50000 && to + step <= buf.length; i++, to += step) {
          let raw;
          if (pe32plus) {
            const lo = buf.readUInt32LE(to), hi = buf.readUInt32LE(to + 4);
            if (lo === 0 && hi === 0) break;
            if (hi & 0x80000000) continue;
            raw = Number(BigInt(lo) + (BigInt(hi) << 32n));
          } else {
            const v = buf.readUInt32LE(to);
            if (v === 0) break;
            if (v & 0x80000000) continue;
            raw = v;
          }
          const h = rvaToOff(raw);
          if (h === null || h + 2 >= buf.length) continue;
          hardImports.push({ dll, fn: cstr(h + 2), delay: isDelay });
        }
      }
    }
  }
  const machine = buf.readUInt16LE(pe + 4);
  return { hardImports, arch: machine === 0x14c ? "x86" : machine === 0x8664 ? "x64" : "?" };
}

function walk(dir, out = []) {
  let ents;
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "locales") continue;
      walk(p, out);
    } else if (/\.(dll|exe)$/i.test(e.name)) out.push(p);
  }
  return out;
}

const targets = process.argv.slice(2);
const files = targets.flatMap((t) =>
  fs.statSync(t).isDirectory() ? walk(t) : [t],
);

let bad = 0;
for (const f of files) {
  let r;
  try {
    r = parse(f);
  } catch (e) {
    console.log(`  SKIP ${path.basename(f)} (${e.message})`);
    continue;
  }
  if (!r) continue;
  const fatal = r.hardImports.filter((i) => !i.delay && WIN10_ONLY.has(i.fn));
  if (fatal.length) {
    bad++;
    console.log(`FAIL ${path.relative(process.cwd(), f)}  [${r.arch}]`);
    for (const i of fatal) console.log(`       hard-imports ${i.dll}!${i.fn}`);
  }
}

console.log(
  `\nchecked ${files.length} binaries - ${bad === 0 ? "PASS: no Win10-only hard imports (Win7-safe)" : `FAIL: ${bad} binaries need Win10 1803+`}`,
);
process.exit(bad === 0 ? 0 : 1);
