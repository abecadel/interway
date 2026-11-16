// Builds an in-memory Graph + Geometry from simple segment lists. Used by tests and the demo graph.
import { COORD_SCALE, Flag, type Geometry, type Graph } from './format';
import { haversine, type LngLat } from './geo';

export interface SegmentInput {
  /** polyline, first and last points become graph nodes (merged when equal) */
  points: LngLat[];
  name?: string;
  /** 'river' gets DOWNSTREAM in drawing direction and UPSTREAM in reverse */
  kind?: 'river' | 'canal' | 'lake' | 'sea' | 'patch';
  lock?: boolean;
  oneway?: boolean;
  /** [maxDraft, maxHeight, maxWidth, maxLength] */
  limits?: [number, number, number, number];
}

export function buildGraph(segments: SegmentInput[]): { graph: Graph; geometry: Geometry; names: string[] } {
  const nodeIds = new Map<string, number>();
  const nodes: LngLat[] = [];
  const nodeOf = (p: LngLat) => {
    const key = `${Math.round(p[0] * COORD_SCALE)},${Math.round(p[1] * COORD_SCALE)}`;
    let id = nodeIds.get(key);
    if (id === undefined) {
      id = nodes.length;
      nodes.push(p);
      nodeIds.set(key, id);
    }
    return id;
  };
  const names = [''];
  const nameOf = (n?: string) => {
    if (!n) return 0;
    let i = names.indexOf(n);
    if (i < 0) i = names.push(n) - 1;
    return i;
  };
  const attrs: number[] = [0, 0, 0, 0];
  const attrOf = (l?: [number, number, number, number]) => {
    if (!l) return 0;
    attrs.push(...l);
    return attrs.length / 4 - 1;
  };

  type E = { from: number; to: number; len: number; geom: number; attr: number; flags: number };
  const edges: E[] = [];
  const geomFrom: number[] = [], geomTo: number[] = [], geomOffsets: number[] = [0], lat: number[] = [], lon: number[] = [], nameIndex: number[] = [];

  segments.forEach((s, g) => {
    const a = nodeOf(s.points[0]), b = nodeOf(s.points[s.points.length - 1]);
    let len = 0;
    for (let i = 1; i < s.points.length; i++) len += haversine(s.points[i - 1][1], s.points[i - 1][0], s.points[i][1], s.points[i][0]);
    for (const p of s.points) {
      lat.push(Math.round(p[1] * COORD_SCALE));
      lon.push(Math.round(p[0] * COORD_SCALE));
    }
    geomFrom.push(a);
    geomTo.push(b);
    geomOffsets.push(lat.length);
    nameIndex.push(nameOf(s.name));
    const attr = attrOf(s.limits);
    let base = 0;
    if (s.lock) base |= Flag.LOCK;
    if (s.kind === 'lake') base |= Flag.LAKE;
    if (s.kind === 'canal') base |= Flag.CANAL;
    if (s.kind === 'sea') base |= Flag.SEA;
    if (s.kind === 'patch') base |= Flag.PATCH;
    edges.push({ from: a, to: b, len, geom: g, attr, flags: base | (s.kind === 'river' ? Flag.DOWNSTREAM : 0) });
    if (!s.oneway) {
      edges.push({ from: b, to: a, len, geom: g, attr, flags: base | Flag.GEOM_REVERSED | (s.kind === 'river' ? Flag.UPSTREAM : 0) });
    }
  });

  edges.sort((x, y) => x.from - y.from);
  const N = nodes.length, M = edges.length;
  const edgeOffsets = new Uint32Array(N + 1);
  for (const e of edges) edgeOffsets[e.from + 1]++;
  for (let i = 0; i < N; i++) edgeOffsets[i + 1] += edgeOffsets[i];

  const graph: Graph = {
    nodeCount: N,
    edgeCount: M,
    nodeLat: Int32Array.from(nodes, (p) => Math.round(p[1] * COORD_SCALE)),
    nodeLon: Int32Array.from(nodes, (p) => Math.round(p[0] * COORD_SCALE)),
    edgeOffsets,
    edgeTarget: Uint32Array.from(edges, (e) => e.to),
    edgeLength: Float32Array.from(edges, (e) => e.len),
    edgeGeom: Uint32Array.from(edges, (e) => e.geom),
    edgeAttr: Uint16Array.from(edges, (e) => e.attr),
    edgeFlags: Uint16Array.from(edges, (e) => e.flags),
    attrTable: Float32Array.from(attrs),
  };
  const geometry: Geometry = {
    geomCount: segments.length,
    geomFrom: Uint32Array.from(geomFrom),
    geomTo: Uint32Array.from(geomTo),
    geomOffsets: Uint32Array.from(geomOffsets),
    lat: Int32Array.from(lat),
    lon: Int32Array.from(lon),
    nameIndex: Uint32Array.from(nameIndex),
  };
  return { graph, geometry, names };
}
