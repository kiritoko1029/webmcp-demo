import type { DeliveryOrder, WorldMapConfig } from '../types/domain';

/**
 * Deterministic FNV-1a 32-bit string hash + Mulberry32 PRNG
 * Guarantees 100% reproducible order fees, PINs, prep times, and dynamic waves for a given seed!
 */
export function hashSeedToUint32(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function createSeededRng(seed: string) {
  let a = hashSeedToUint32(seed) || 1;
  const nextFloat = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    nextFloat,
    nextInt(min: number, max: number): number {
      return Math.floor(nextFloat() * (max - min + 1)) + min;
    },
    pick<T>(arr: readonly T[]): T {
      return arr[Math.floor(nextFloat() * arr.length) % arr.length];
    },
  };
}

export function generateRandomSeedId(prefix = 'RG'): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}-${code}`;
}

export interface ShareableWorldPackage {
  v: 1;
  map: Omit<WorldMapConfig, 'initialOrdersSnapshot'>;
  orders: DeliveryOrder[];
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const padded = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + '='.repeat(padLen));
  const buf = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Compresses the entire World Director map + merchants + hazards + initial orders into a compact
 * URL-safe shareable seed string (`RGW1_<deflate_base64url>`), so ANY AI-generated world can be
 * shared via URL or pasted across browsers/models with 100% fidelity!
 */
export async function encodeWorldToShareSeed(
  worldMap: WorldMapConfig,
  fallbackCurrentOrders: DeliveryOrder[],
): Promise<string> {
  const { initialOrdersSnapshot, ...cleanMap } = worldMap;
  const baselineOrders =
    initialOrdersSnapshot && initialOrdersSnapshot.length > 0
      ? initialOrdersSnapshot
      : fallbackCurrentOrders;

  const pkg: ShareableWorldPackage = {
    v: 1,
    map: cleanMap,
    orders: baselineOrders,
  };

  const jsonBytes = new TextEncoder().encode(JSON.stringify(pkg));

  if (typeof CompressionStream !== 'undefined') {
    const cs = new CompressionStream('deflate-raw');
    const writer = cs.writable.getWriter();
    void writer.write(jsonBytes);
    void writer.close();
    const compressedBuf = await new Response(cs.readable).arrayBuffer();
    return `RGW1_${bytesToBase64Url(new Uint8Array(compressedBuf))}`;
  }

  return `RGJ1_${bytesToBase64Url(jsonBytes)}`;
}

/**
 * Decodes either a full URL containing `#world=...` / `?world=...`, a compressed `RGW1_...`
 * snapshot token, or returns `{ kind: 'short_seed', seed }` for short deterministic seeds!
 */
export async function parseWorldSeedInput(
  rawInput: string,
): Promise<
  | { kind: 'snapshot'; pkg: ShareableWorldPackage }
  | { kind: 'short_seed'; seed: string }
> {
  let trimmed = rawInput.trim();
  if (!trimmed) {
    throw new Error('请输入世界种子码或分享链接');
  }

  // If user pasted a full URL, extract #world= or ?world= or #seed=
  if (/^https?:\/\//i.test(trimmed) || trimmed.includes('#world=') || trimmed.includes('?world=')) {
    try {
      const hashIdx = trimmed.indexOf('#');
      const queryIdx = trimmed.indexOf('?');
      if (hashIdx >= 0) {
        const hashParams = new URLSearchParams(trimmed.slice(hashIdx + 1));
        const w = hashParams.get('world') || hashParams.get('seed');
        if (w) trimmed = w.trim();
      } else if (queryIdx >= 0) {
        const qParams = new URLSearchParams(trimmed.slice(queryIdx + 1));
        const w = qParams.get('world') || qParams.get('seed');
        if (w) trimmed = w.trim();
      }
    } catch {
      // Continue with raw string
    }
  }

  if (trimmed.startsWith('RGW1_')) {
    const compressed = base64UrlToBytes(trimmed.slice(5));
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('当前浏览器不支持 DecompressionStream 解压世界快照');
    }
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    void writer.write(compressed);
    void writer.close();
    const decompressedBuf = await new Response(ds.readable).arrayBuffer();
    const jsonStr = new TextDecoder().decode(decompressedBuf);
    const pkg = JSON.parse(jsonStr) as ShareableWorldPackage;
    if (!pkg?.map?.themeName || !Array.isArray(pkg.orders)) {
      throw new Error('世界种子快照格式校验失败');
    }
    return { kind: 'snapshot', pkg };
  }

  if (trimmed.startsWith('RGJ1_')) {
    const rawBytes = base64UrlToBytes(trimmed.slice(5));
    const jsonStr = new TextDecoder().decode(rawBytes);
    const pkg = JSON.parse(jsonStr) as ShareableWorldPackage;
    return { kind: 'snapshot', pkg };
  }

  return { kind: 'short_seed', seed: trimmed };
}

export async function buildShareableWorldUrl(
  worldMap: WorldMapConfig,
  fallbackOrders: DeliveryOrder[],
): Promise<{ url: string; token: string }> {
  const token = await encodeWorldToShareSeed(worldMap, fallbackOrders);
  const base = `${window.location.origin}${window.location.pathname}`;
  return {
    token,
    url: `${base}#world=${token}`,
  };
}
