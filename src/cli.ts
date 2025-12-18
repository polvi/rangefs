import { build } from './lib/builder';

const command = process.argv[2];
if (command === 'build') {
  const inputDir = process.argv[3];
  const outputFile = process.argv[4];
  const compress = process.argv[5] === '--compress';
  if (!inputDir || !outputFile) {
    console.error('Usage: node cli.js build <inputDir> <outputFile> [--compress]');
    process.exit(1);
  }
  build(inputDir, outputFile, { compress });
  console.log(`Built ${outputFile} from ${inputDir}${compress ? ' with compression' : ''}`);
} else {
  console.error('Unknown command. Use: build');
  process.exit(1);
}
