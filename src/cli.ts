import { build } from './lib/builder';

const command = process.argv[2];
if (command === 'build') {
  const inputDir = process.argv[3];
  const outputFile = process.argv[4];
  
  if (!inputDir || !outputFile) {
    console.error('Usage: bun run src/cli.ts build <inputDir> <outputFile>');
    process.exit(1);
  }
  
  build(inputDir, outputFile);
  console.log(`Built ${outputFile} from ${inputDir}`);
} else {
  console.error('Unknown command. Use: build');
  process.exit(1);
}
