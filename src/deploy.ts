import { build } from './lib/builder';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const distPath = process.argv[2];

if (!distPath) {
  console.error('Usage: bun run deploy <distPath>');
  process.exit(1);
}

if (!fs.existsSync(distPath)) {
  console.error(`Error: Directory ${distPath} does not exist`);
  process.exit(1);
}

// Read wrangler.toml to extract hostname
const wranglerToml = fs.readFileSync('wrangler.toml', 'utf-8');
const routeMatch = wranglerToml.match(/pattern\s*=\s*"([^"]+)"/);
if (!routeMatch) {
  console.error('Error: Could not find route pattern in wrangler.toml');
  process.exit(1);
}
const hostname = routeMatch[1];

// Read bucket name from wrangler.toml
const bucketMatch = wranglerToml.match(/bucket_name\s*=\s*"([^"]+)"/);
if (!bucketMatch) {
  console.error('Error: Could not find bucket_name in wrangler.toml');
  process.exit(1);
}
const bucketName = bucketMatch[1];

// Read KV namespace ID from wrangler.toml
const kvIdMatch = wranglerToml.match(/id\s*=\s*"([^"]+)"/);
if (!kvIdMatch) {
  console.error('Error: Could not find KV namespace id in wrangler.toml');
  process.exit(1);
}
const kvNamespaceId = kvIdMatch[1];

const outputFile = '/tmp/dist.rangefs';

console.log(`Building rangefs archive from ${distPath}...`);
build(distPath, outputFile);
console.log(`✓ Built ${outputFile}`);

console.log(`Uploading to R2 bucket ${bucketName}...`);
execSync(`wrangler r2 object put ${bucketName}/dist.rangefs --local --file=${outputFile}`, {
  stdio: 'inherit'
});
console.log(`✓ Uploaded to R2`);

console.log(`Setting KV value for ${hostname}:ARCHIVE_FILENAME...`);
execSync(`wrangler kv key put --local --namespace-id=${kvNamespaceId} "${hostname}:ARCHIVE_FILENAME" "dist.rangefs"`, {
  stdio: 'inherit'
});
console.log(`✓ Set KV value`);

console.log(`\n✓ Deployment complete for ${hostname}`);
