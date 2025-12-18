import { build } from './lib/builder';

const command = process.argv[2];
if (command === 'build') {
  const inputDir = process.argv[3];
  const outputFile = process.argv[4];
  const compressArg = process.argv[5];
  
  let compress = false;
  if (compressArg) {
    if (compressArg === '--compress') {
      compress = true;
    } else {
      console.error('Invalid argument. Use: --compress');
      process.exit(1);
    }
  }
  
  if (!inputDir || !outputFile) {
    console.error('Usage: bun run src/cli.ts build <inputDir> <outputFile> [--compress]');
    process.exit(1);
  }
  
  build(inputDir, outputFile, { compress });
  const compressMsg = compress ? ' with gzip compression' : '';
  console.log(`Built ${outputFile} from ${inputDir}${compressMsg}`);
} else {
  console.error('Unknown command. Use: build');
  process.exit(1);
}
