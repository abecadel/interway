// Reader/writer for the Interway graph format v1. Spec: docs/graph-format.md

export const COORD_SCALE = 1e7;

export const Flag = {
  LOCK: 1 << 0,
  LAKE: 1 << 1,
  DOWNSTREAM: 1 << 2,
  UPSTREAM: 1 << 3,
  SEA: 1 << 4,
  GEOM_REVERSED: 1 << 5,
  CANAL: 1 << 6,
  PATCH: 1 << 7,
} as const;

export interface Graph {
  nodeCount: number;
  edgeCount: number;
  nodeLat: Int32Array;
  nodeLon: Int32Array;
  edgeOffsets: Uint32Array;
  edgeTarget: Uint32Array;
  edgeLength: Float32Array;
  edgeGeom: Uint32Array;
  edgeAttr: Uint16Array;
  edgeFlags: Uint16Array;
  /** rows of [maxDraft, maxHeight, maxWidth, maxLength], 0 = unknown */
  attrTable: Float32Array;
}

export interface Geometry {
  geomCount: number;
  geomFrom: Uint32Array;
  geomTo: Uint32Array;
  geomOffsets: Uint32Array;
  lat: Int32Array;
  lon: Int32Array;
  nameIndex: Uint32Array;
}

const align4 = (n: number) => (n + 3) & ~3;

function checkMagic(view: DataView, magic: string) {
  const got = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (got !== magic) throw new Error(`bad magic: expected ${magic}, got ${got}`);
  const version = view.getUint32(4, true);
  if (version !== 1) throw new Error(`unsupported version ${version}`);
}

/** Sequential typed-array slicer that keeps 4-byte alignment. Copies, so the input buffer can be any offset. */
class Reader {
  pos: number;
  private buf: ArrayBuffer;
  constructor(buf: ArrayBuffer, start: number) {
    this.buf = buf;
    this.pos = start;
  }
  take<T>(Ctor: { new (b: ArrayBuffer, o: number, l: number): T; BYTES_PER_ELEMENT: number }, count: number): T {
    const bytes = count * Ctor.BYTES_PER_ELEMENT;
    if (this.pos + bytes > this.buf.byteLength) throw new Error('truncated file');
    const arr = new Ctor(this.buf, this.pos, count);
    this.pos = align4(this.pos + bytes);
    return arr;
  }
}

export function decodeGraph(buf: ArrayBuffer): Graph {
  const view = new DataView(buf);
  checkMagic(view, 'IWG1');
  const nodeCount = view.getUint32(8, true);
  const edgeCount = view.getUint32(12, true);
  const attrCount = view.getUint32(16, true);
  const r = new Reader(buf, 20);
  return {
    nodeCount,
    edgeCount,
    nodeLat: r.take(Int32Array, nodeCount),
    nodeLon: r.take(Int32Array, nodeCount),
    edgeOffsets: r.take(Uint32Array, nodeCount + 1),
    edgeTarget: r.take(Uint32Array, edgeCount),
    edgeLength: r.take(Float32Array, edgeCount),
    edgeGeom: r.take(Uint32Array, edgeCount),
    edgeAttr: r.take(Uint16Array, edgeCount),
    edgeFlags: r.take(Uint16Array, edgeCount),
    attrTable: r.take(Float32Array, attrCount * 4),
  };
}

export function decodeGeometry(buf: ArrayBuffer): Geometry {
  const view = new DataView(buf);
  checkMagic(view, 'IWS1');
  const geomCount = view.getUint32(8, true);
  const pointCount = view.getUint32(12, true);
  const r = new Reader(buf, 16);
  return {
    geomCount,
    geomFrom: r.take(Uint32Array, geomCount),
    geomTo: r.take(Uint32Array, geomCount),
    geomOffsets: r.take(Uint32Array, geomCount + 1),
    lat: r.take(Int32Array, pointCount),
    lon: r.take(Int32Array, pointCount),
    nameIndex: r.take(Uint32Array, geomCount),
  };
}

// ---------- writer (used by tests and the demo graph builder; the pipeline has its own in Python) ----------

type Typed = Int32Array | Uint32Array | Float32Array | Uint16Array;

function writeFile(magic: string, header: number[], arrays: Typed[]): ArrayBuffer {
  let size = 4 + 4 * (header.length + 1);
  for (const a of arrays) size = align4(size + a.byteLength);
  const buf = new ArrayBuffer(size);
  const bytes = new Uint8Array(buf);
  const view = new DataView(buf);
  for (let i = 0; i < 4; i++) bytes[i] = magic.charCodeAt(i);
  view.setUint32(4, 1, true);
  header.forEach((v, i) => view.setUint32(8 + 4 * i, v, true));
  let pos = 8 + 4 * header.length;
  for (const a of arrays) {
    bytes.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), pos);
    pos = align4(pos + a.byteLength);
  }
  return buf;
}

export function encodeGraph(g: Graph): ArrayBuffer {
  return writeFile('IWG1', [g.nodeCount, g.edgeCount, g.attrTable.length / 4], [
    g.nodeLat, g.nodeLon, g.edgeOffsets, g.edgeTarget, g.edgeLength, g.edgeGeom, g.edgeAttr, g.edgeFlags, g.attrTable,
  ]);
}

export function encodeGeometry(g: Geometry): ArrayBuffer {
  return writeFile('IWS1', [g.geomCount, g.lat.length], [
    g.geomFrom, g.geomTo, g.geomOffsets, g.lat, g.lon, g.nameIndex,
  ]);
}
