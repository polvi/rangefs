import type { Entry } from './lib/types';

interface Env {
  BUCKET: R2Bucket;
  CONFIG: KVNamespace;
}

// Module-level cache for the index
let cachedIndex: Map<string, Entry> | null = null;
let cachedArchiveFilename: string | null = null;

async function getArchiveFilename(env: Env): Promise<string> {
  const filename = await env.CONFIG.get('ARCHIVE_FILENAME');
  if (!filename) {
    throw new Error('ARCHIVE_FILENAME not found in KV');
  }
  
  return filename;
}

async function loadIndex(env: Env): Promise<Map<string, Entry>> {
  const archiveFilename = await getArchiveFilename(env);

  // Fetch footer (last 16 bytes)
  const footerResponse = await env.BUCKET.get(archiveFilename, {
    range: { suffix: 16 }
  });
  if (!footerResponse) throw new Error('Failed to fetch footer');
  const footerBuffer = await footerResponse.arrayBuffer();
  const footerView = new DataView(footerBuffer);
  const indexOffset = footerView.getBigUint64(0, true);
  const indexLength = footerView.getBigUint64(8, true);

  // Fetch index
  const indexResponse = await env.BUCKET.get(archiveFilename, {
    range: { offset: Number(indexOffset), length: Number(indexLength) }
  });
  if (!indexResponse) throw new Error('Failed to fetch index');
  const indexBuffer = await indexResponse.arrayBuffer();
  const indexView = new DataView(indexBuffer);

  let offset = 0;
  const entryCount = indexView.getUint32(offset, true);
  offset += 4;

  const entries: Entry[] = [];
  for (let i = 0; i < entryCount; i++) {
    const pathLength = indexView.getUint16(offset, true);
    offset += 2;
    const pathBytes = new Uint8Array(indexBuffer, offset, pathLength);
    const path = new TextDecoder('utf-8').decode(pathBytes);
    offset += pathLength;
    const entryOffset = indexView.getBigUint64(offset, true);
    offset += 8;
    const length = indexView.getBigUint64(offset, true);
    offset += 8;
    const flags = indexView.getUint8(offset);
    offset += 1;
    entries.push({ path, offset: entryOffset, length, flags });
  }

  return new Map(entries.map(e => [e.path, e]));
}

async function getIndex(env: Env): Promise<Map<string, Entry>> {
  const archiveFilename = await getArchiveFilename(env);
  
  // Check if cache is valid
  if (cachedIndex && cachedArchiveFilename === archiveFilename) {
    return cachedIndex;
  }
  
  // Cache miss or bust - reload index
  const index = await loadIndex(env);
  cachedIndex = index;
  cachedArchiveFilename = archiveFilename;
  
  return index;
}

function getContentType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'html': return 'text/html; charset=utf-8';
    case 'css': return 'text/css; charset=utf-8';
    case 'js': return 'application/javascript; charset=utf-8';
    case 'json': return 'application/json; charset=utf-8';
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'svg': return 'image/svg+xml';
    case 'webp': return 'image/webp';
    case 'ico': return 'image/x-icon';
    case 'woff': return 'font/woff';
    case 'woff2': return 'font/woff2';
    case 'ttf': return 'font/ttf';
    case 'eot': return 'application/vnd.ms-fontobject';
    case 'xml': return 'application/xml';
    case 'txt': return 'text/plain; charset=utf-8';
    default: return 'application/octet-stream';
  }
}

function toSafeNumber(value: bigint): number {
  if (value > Number.MAX_SAFE_INTEGER) {
    throw new Error(`Value ${value} exceeds MAX_SAFE_INTEGER`);
  }
  return Number(value);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const index = await getIndex(env);

    const url = new URL(request.url);
    let path = url.pathname.slice(1); // Remove leading /
    path = path.replace(/\/$/, ''); // Remove trailing /

    let finalPath = path;
    if (path === '') {
      finalPath = 'index.html';
    } else {
      let entry = index.get(path);
      if (!entry && !path.includes('.')) {
        finalPath = path + '/index.html';
        entry = index.get(finalPath);
      }
      if (!entry) {
        return new Response('Not Found', { status: 404 });
      }
    }

    const entry = index.get(finalPath);
    if (!entry) {
      return new Response('Not Found', { status: 404 });
    }

    const archiveFilename = await getArchiveFilename(env);

    const obj = await env.BUCKET.get(archiveFilename, {
      range: {
        offset: toSafeNumber(entry.offset),
        length: toSafeNumber(entry.length),
      }
    });

    if (!obj) return new Response("Not found", { status: 404 });

    const headers = new Headers();
    headers.set("Content-Type", getContentType(finalPath));

    if (entry.flags & 1) headers.set("Content-Encoding", "gzip");

    // This is critical for proxies and CDNs
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.set("Vary", "Accept-Encoding");

    return new Response(obj.body, {
      status: 200,
      headers
    });
  }
};
