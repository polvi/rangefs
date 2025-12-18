import { Entry, Footer } from './lib/types';

const ALL_FILE_URL = 'https://example.com/site.all'; // Replace with actual URL

let index: Map<string, Entry> | null = null;

async function loadIndex(): Promise<void> {
  if (index) return;

  // Fetch footer (last 16 bytes)
  const footerResponse = await fetch(ALL_FILE_URL, {
    headers: { Range: 'bytes=-16' }
  });
  const footerBuffer = await footerResponse.arrayBuffer();
  const footerView = new DataView(footerBuffer);
  const indexOffset = footerView.getBigUint64(0, true);
  const indexLength = footerView.getBigUint64(8, true);

  // Fetch index
  const indexResponse = await fetch(ALL_FILE_URL, {
    headers: { Range: `bytes=${indexOffset}-${indexOffset + indexLength - 1n}` }
  });
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

  index = new Map(entries.map(e => [e.path, e]));
}

function getContentType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'html': return 'text/html';
    case 'css': return 'text/css';
    case 'js': return 'application/javascript';
    case 'json': return 'application/json';
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'svg': return 'image/svg+xml';
    default: return 'application/octet-stream';
  }
}

export async function handleRequest(request: Request): Promise<Response> {
  await loadIndex();

  const url = new URL(request.url);
  let path = url.pathname.slice(1); // Remove leading /
  if (path === '') path = 'index.html'; // Default to index.html for root

  const entry = index!.get(path);
  if (!entry) {
    return new Response('Not Found', { status: 404 });
  }

  const rangeStart = entry.offset;
  const rangeEnd = entry.offset + entry.length - 1n;

  const fileResponse = await fetch(ALL_FILE_URL, {
    headers: { Range: `bytes=${rangeStart}-${rangeEnd}` }
  });

  const headers = new Headers();
  headers.set('Content-Type', getContentType(path));
  if (entry.flags & 1) { // gzip
    headers.set('Content-Encoding', 'gzip');
  } else if (entry.flags & 2) { // brotli
    headers.set('Content-Encoding', 'br');
  }
  headers.set('Cache-Control', 'public, max-age=31536000'); // Long cache

  return new Response(fileResponse.body, {
    status: 200,
    headers
  });
}

// For Cloudflare Workers
addEventListener('fetch', (event) => {
  event.respondWith(handleRequest(event.request));
});
