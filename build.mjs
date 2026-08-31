import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const serve = process.argv.includes('--serve');

const options = {
  entryPoints: ['src/time-picker-card.ts'],
  bundle: true,
  format: 'esm',
  target: 'es2020',
  outfile: 'dist/time-picker-card.js',
  minify: !watch,
  sourcemap: watch,
  legalComments: 'none',
};

if (watch || serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('Watching for changes...');

  if (serve) {
    const { host, port } = await ctx.serve({ servedir: 'dist', port: 5000 });
    console.log(`Serving on http://${host}:${port}`);
  }
} else {
  await esbuild.build(options);
  console.log('Build complete: dist/time-picker-card.js');
}
