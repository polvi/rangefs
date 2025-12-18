import { build } from './lib/builder';

const command = process.argv[2];
if (command === 'build') {
  const inputDir = process.argv[3];
  const outputFile = process.argv[4];
  const compressArg = process.argv[5];
  
  let compress: 'gzip' | 'br' | 'none' = 'none';
  if (compressArg) {
    if (compressArg.startsWith('--compress=')) {
      const value = compressArg.split('=')[1];
      if (value === 'gzip' || value === 'br' || value === 'none') {
        compress = value;
      } else {
        console.error('Invalid compression type. Use: gzip, br, or none');
        process.exit(1);
      }
    } else {
      console.error('Invalid argument. Use: --compress=<gzip|br|none>');
      process.exit(1);
    }
  }
  
  if (!inputDir || !outputFile) {
    console.error('Usage: bun run src/cli.ts build <inputDir> <outputFile> [--compress=<gzip|br|none>]');
    process.exit(1);
  }
  
  build(inputDir, outputFile, { compress });
  const compressMsg = compress === 'none' ? '' : ` with ${compress} compression`;
  console.log(`Built ${outputFile} from ${inputDir}${compressMsg}`);
} else {
  console.error('Unknown command. Use: build');
  process.exit(1);
}
