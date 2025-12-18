import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import type { Entry, BuildOptions } from './types';

function getFiles(dir: string): string[] {
  const files: string[] = [];

  function walk(current: string) {
    const items = fs.readdirSync(path.join(dir, current));
    for (const item of items) {
      const full = path.join(dir, current, item);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(path.join(current, item));
      } else {
        files.push(path.join(current, item));
      }
    }
  }

  walk('');
  return files;
}

export function build(inputDir: string, outputFile: string, options: BuildOptions = {}) {
  const files = getFiles(inputDir);
  const fd = fs.openSync(outputFile, 'w');
  let offset = 0n;
  const entries: Entry[] = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(inputDir, file));
    let compressed = content;
    let flags = 0;
    if (options.compress) {
      compressed = zlib.gzipSync(content);
      flags |= 1; // gzip
    }
    fs.writeSync(fd, compressed);
    entries.push({
      path: file.replace(/\\/g, '/'), // normalize to /
      offset,
      length: BigInt(compressed.length),
      flags
    });
    offset += BigInt(compressed.length);
  }

  // Write index
  const indexStart = offset;
  const entryCount = entries.length;
  const indexBuffers: Buffer[] = [];

  // entry_count
  const countBuffer = Buffer.alloc(4);
  countBuffer.writeUInt32LE(entryCount, 0);
  indexBuffers.push(countBuffer);

  for (const entry of entries) {
    const pathBytes = Buffer.from(entry.path, 'utf8');
    const pathLen = pathBytes.length;
    const entryBuffer = Buffer.alloc(2 + pathLen + 8 + 8 + 1);
    entryBuffer.writeUInt16LE(pathLen, 0);
    pathBytes.copy(entryBuffer, 2);
    entryBuffer.writeBigUInt64LE(entry.offset, 2 + pathLen);
    entryBuffer.writeBigUInt64LE(entry.length, 2 + pathLen + 8);
    entryBuffer.writeUInt8(entry.flags, 2 + pathLen + 8 + 8);
    indexBuffers.push(entryBuffer);
  }

  let indexLength = 0n;
  for (const buf of indexBuffers) {
    indexLength += BigInt(buf.length);
    fs.writeSync(fd, buf);
  }

  // Write footer
  const footer = Buffer.alloc(16);
  footer.writeBigUInt64LE(indexStart, 0);
  footer.writeBigUInt64LE(indexLength, 8);
  fs.writeSync(fd, footer);

  fs.closeSync(fd);
}
