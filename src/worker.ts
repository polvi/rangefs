import { Entry } from './lib/types';

interface Env {
  BUCKET: R2Bucket;
}

let index: Map<string, Entry> | null = null;

async function loadIndex(env: Env): Promise<void> {
  if (index) return;

  // Fetch footer (last 16 bytes)
  const footerResponse = await env.BUCKET.get('site.all', {
    range: { suffix: 16 }
  });
  if (!footerResponse) throw new Error('Failed to fetch footer');
  const footerBuffer = await footerResponse.arrayBuffer();
  const footerView = new DataView(footerBuffer);
  const indexOffset = footerView.getBigUint64(0, true);
  const indexLength = footerView.getBigUint64(8, true);

  // Fetch index
  const indexResponse = await env.BUCKET.get('site.all', {
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    await loadIndex(env);

    const url = new URL(request.url);
    let path = url.pathname.slice(1); // Remove leading /
    path = path.replace(/\/$/, ''); // Remove trailing /

    let finalPath = path;
    if (path === '') {
      finalPath = 'index.html';
    } else {
      let entry = index!.get(path);
      if (!entry && !path.includes('.')) {
        finalPath = path + '/index.html';
        entry = index!.get(finalPath);
      }
      if (!entry) {
        return new Response('Not Found', { status: 404 });
      }
    }

    const entry = index!.get(finalPath);
    if (!entry) {
      return new Response('Not Found', { status: 404 });
    }

    const fileResponse = await env.BUCKET.get('site.all', {
      range: { offset: Number(entry.offset), length: Number(entry.length) }
    });
    if (!fileResponse) {
      return new Response('Internal Server Error', { status: 500 });
    }

    let body = fileResponse.body;
    
    // Decompress if needed
    if (entry.flags & 1) { // gzip
      const compressed = await fileResponse.arrayBuffer();
      const decompressed = new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip')));
      body = decompressed.body;
    } else if (entry.flags & 2) { // brotli
      const compressed = await fileResponse.arrayBuffer();
      const decompressed = new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate')));
      body = decompressed.body;
    }

    const headers = new Headers();
    headers.set('Content-Type', getContentType(finalPath));
    headers.set('Cache-Control', 'public, max-age=31536000'); // Long cache

    return new Response(body, {
      status: 200,
      headers
    });
  }
};
