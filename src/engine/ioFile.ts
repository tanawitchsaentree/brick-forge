// Reads the model out of a BrickLink Studio .io file: a ZIP whose entries are
// encrypted with ZipCrypto under Studio's fixed password (the same one every
// .io → LDraw converter uses). Inflates with the browser's own
// DecompressionStream, so there's no dependency.

const STUDIO_PASSWORD = "soho0909";

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32Byte = (crc: number, b: number) => (CRC[(crc ^ b) & 0xff] ^ (crc >>> 8)) >>> 0;

/** Traditional PKWARE (ZipCrypto) decryption of one entry's data. */
function unZipCrypto(data: Uint8Array, password: string): Uint8Array {
  let k0 = 0x12345678, k1 = 0x23456789, k2 = 0x34567890;
  const update = (c: number) => {
    k0 = crc32Byte(k0, c);
    k1 = (Math.imul((k1 + (k0 & 0xff)) >>> 0, 134775813) + 1) >>> 0;
    k2 = crc32Byte(k2, k1 >>> 24);
  };
  for (const ch of password) update(ch.charCodeAt(0));
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const t = (k2 | 2) & 0xffff;
    const c = data[i] ^ ((Math.imul(t, t ^ 1) >>> 8) & 0xff);
    update(c);
    out[i] = c;
  }
  return out.subarray(12); // the 12-byte encryption header
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The entries of a ZIP (read from its central directory). */
function entries(buf: Uint8Array) {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--)
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error("Not a ZIP file");
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const list: { name: string; flags: number; method: number; size: number; offset: number }[] = [];
  for (let n = 0; n < count; n++) {
    const nameLen = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true), comment = v.getUint16(p + 32, true);
    list.push({
      name: new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen)),
      flags: v.getUint16(p + 8, true),
      method: v.getUint16(p + 10, true),
      size: v.getUint32(p + 20, true),
      offset: v.getUint32(p + 42, true),
    });
    p += 46 + nameLen + extra + comment;
  }
  return { list, v };
}

/** The LDraw text of a Studio .io file's model. */
export async function readIoModel(file: ArrayBuffer): Promise<string> {
  const buf = new Uint8Array(file);
  const { list, v } = entries(buf);
  const e = list.find((x) => x.name.toLowerCase() === "model.ldr") ?? list.find((x) => /\.ldr$/i.test(x.name));
  if (!e) throw new Error("No model in this .io file");
  const start = e.offset + 30 + v.getUint16(e.offset + 26, true) + v.getUint16(e.offset + 28, true);
  let data: Uint8Array<ArrayBufferLike> = buf.subarray(start, start + e.size);
  if (e.flags & 1) data = unZipCrypto(data, STUDIO_PASSWORD);
  const raw: Uint8Array<ArrayBufferLike> = e.method === 8 ? await inflateRaw(data) : data;
  return new TextDecoder().decode(raw);
}
