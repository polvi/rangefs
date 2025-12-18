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

function generateETag(path: string, offset: bigint, length: bigint): string {
  // Simple ETag based on path and file metadata
  return `"${path}-${offset}-${length}"`;
}

function isHtmlFile(path: string): boolean {
  return path.endsWith('.html');
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

    // Generate ETag
    const etag = generateETag(finalPath, entry.offset, entry.length);

    // Check If-None-Match for 304 responses
    const ifNoneMatch = request.headers.get('If-None-Match');
    if (ifNoneMatch === etag) {
      return new Response(null, {
        status: 304,
        headers: {
          'ETag': etag,
          'Cache-Control': isHtmlFile(finalPath) 
            ? 'public, max-age=0, must-revalidate' 
            : 'public, max-age=31536000, immutable'
        }
      });
    }

    // Handle HEAD requests
    if (request.method === 'HEAD') {
      const headers = new Headers();
      headers.set('Content-Type', getContentType(finalPath));
      headers.set('ETag', etag);
      headers.set('Cache-Control', isHtmlFile(finalPath) 
        ? 'public, max-age=0, must-revalidate' 
        : 'public, max-age=31536000, immutable');
      headers.set('X-Content-Type-Options', 'nosniff');
      
      return new Response(null, {
        status: 200,
        headers
      });
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
      const decompressed = new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('br')));
      body = decompressed.body;
    }

    const headers = new Headers();
    headers.set('Content-Type', getContentType(finalPath));
    headers.set('ETag', etag);
    
    // Different cache strategies for HTML vs assets
    if (isHtmlFile(finalPath)) {
      // HTML: always revalidate but allow caching
      headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
    } else {
      // Assets: long-term cache with immutable flag
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');
    }
    
    // Security headers
    headers.set('X-Content-Type-Options', 'nosniff');

    return new Response(body, {
      status: 200,
      headers
    });
  }
};
