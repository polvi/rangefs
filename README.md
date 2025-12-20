# .rangefs file format

A `.rangefs` file is an immutable file format for distributing static site content as a single, indexed artifact. It is conceptually similar to SQLite or squashfs, but for static file systems rather than structured records or a POSIX filesytem. 

An `.rangefs` file is designed to be deployed to an object store and accessed via HTTP range requests. A lightweight runtime, such as a Cloudflare Worker, can resolve logical paths to byte ranges and stream individual files without unpacking the archive.

It is intended to be simple enough an LLM could easily understand the file format based on his README alone. If the `.rangefs` file was publically exposed, this would allow AI agents to fetch all the data they need, without hammering the server with individual requests. 

Core properties:

* Immutable, content addressed friendly
* Optimized for range requests
* Single object per deploy
* No runtime mutation or database required
* Suitable for very large sites with frequent rebuilds

## Usage

### Installation

Install dependencies using Bun:

```bash
bun install
```

### Building an archive

Build a `.rangefs` archive from a directory of static files:

```bash
bun run src/cli.ts build <input-directory> <output-file>
```

Examples:

```bash
bun run src/cli.ts build ./dist ./site.rangefs
```

This will create a `site.rangefs` file containing all files from the `./dist` directory.

### Deploying to Cloudflare

#### 1. Upload the archive to R2

Upload your `.rangefs` file to Cloudflare R2:

```bash
wrangler r2 object put rangefs/site.rangefs --file=./site.rangefs
```

Replace `rangefs` with your R2 bucket name.

#### 2. Configure the archive filename in KV

Set the archive filename in Cloudflare KV so the worker knows which file to serve:

```bash
wrangler kv key put --binding=CONFIG ARCHIVE_FILENAME "site.rangefs"
```

#### 3. Deploy the worker

Deploy the Cloudflare Worker:

```bash
wrangler deploy
```

Your static site will now be served from the `.rangefs` archive via the worker.

### Local development

For local development with Wrangler:

```bash
wrangler dev
```

## Format reference

All integers are little endian.

### High level layout

```
| file data section | index section | footer |
```

### File data section

The file data section is a raw concatenation of file contents. Files are written back to back with no padding or alignment requirements.

The order of files is determined at build time and does not matter at read time.

### Index section

The index section maps logical paths to byte ranges within the file data section.

Index layout:

```
uint32   entry_count

repeated entry_count times:
  uint16   path_length
  bytes    path (UTF 8)
  uint64   offset
  uint64   length
```

Offsets are relative to the beginning of the file data section.

### Footer

The footer is a fixed size structure at the end of the file, allowing the index to be discovered with a single range request.

Footer layout, always last 16 bytes:

```
uint64   index_offset
uint64   index_length
```

The index offset is the absolute byte offset from the beginning of the file.

### Read flow

A typical reader performs the following steps:

1. Range request the last 16 bytes to read the footer
2. Range request the index using index_offset and index_length
3. Resolve the requested path to an offset and length
4. Range request the file bytes
5. Stream the response to the client

The index is small enough to be cached in memory for fast lookups.

## Why not use other existing formats

There are several formats that are close, but none that fully match the requirements of large, frequently changing static sites served via HTTP range requests.

### Tar

Tar is a simple concatenation format and is easy to generate, but it lacks a native index. Accessing a file requires scanning headers sequentially, which makes random access impractical over HTTP.

While tar can be augmented with external indexes, doing so effectively recreates a custom format without solving compression or metadata concerns.

### Zip

Zip includes a central directory at the end of the file, which makes random access possible. However, most zip tooling assumes local file access with arbitrary seeking. Using zip efficiently over HTTP requires multiple range requests and custom parsing logic.

Additionally, zip compression is file oriented but opaque to streaming runtimes, and the format carries significant historical complexity that is unnecessary for static site distribution.



### Others

Formats like squashfs, cpio, or container image layers are optimized for operating systems or container runtimes, not HTTP range access. They often require kernel support, mounting semantics, or full extraction before use.

SQLite is conceptually similar, but it is optimized for structured queries rather than raw byte streaming, and introduces unnecessary complexity for static assets.

PMTiles and cloud optimized GeoTIFFs demonstrate that indexed, range friendly formats work extremely well, but they are domain specific rather than general purpose.

## This repository

This repository contains a reference TypeScript implementation of the `.rangefs` format, including both a build time CLI and a runtime HTTP reader designed for edge environments.

### CLI builder

The CLI builds `.rangefs` files from a directory of static assets.

Responsibilities:

* Walk a directory tree and normalize paths
* Apply ignore rules
* Write file contents sequentially
* Generate and append the index and footer
* Produce a single immutable `.rangefs` artifact

The CLI is intended to run in CI as part of a static site build pipeline.

Example usage:

```
bun run src/cli.ts build ./dist ./site.rangefs
```

### Worker runtime

The Worker implementation demonstrates how to serve an `.rangefs` file from an object store using HTTP range requests.

Responsibilities:

* Fetch and cache the index on startup
* Resolve request paths to byte ranges
* Perform range requests against the `.rangefs` object
* Stream responses with correct headers
* Remain stateless and read only at runtime

The Worker is designed to be small, dependency light, and suitable for Cloudflare Workers or similar edge runtimes.

### Reference, not mandate

The implementations in this repository are intended to be reference quality, not prescriptive. Other languages, build systems, and runtimes are expected to implement compatible readers and writers.

The `.rangefs` format itself is intentionally simple so it can be implemented correctly from the specification alone.
