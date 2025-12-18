import { build } from './lib/builder';

const command = process.argv[2];
if (command === 'build') {
  const inputDir = process.argv[3];
  const outputFile = process.argv[4];
  if (!inputDir || !outputFile) {
    console.error('Usage: node cli.js build <inputDir> <outputFile>');
    process.exit(1);
  }
  build(inputDir, outputFile, { compress: false }); // Default to not compress for demo
  console.log(`Built ${outputFile} from ${inputDir}`);
} else {
  console.error('Unknown command. Use: build');
  process.exit(1);
}
