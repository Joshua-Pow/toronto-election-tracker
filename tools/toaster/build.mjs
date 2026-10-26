import * as esbuild from 'esbuild';
const noInsertCSS = { name: 'no-insert-css', setup(b) {
  b.onLoad({ filter: /sonner[\\/]dist[\\/]index\.mjs$/ }, async (a) => {
    const fs = await import('fs'); let s = fs.readFileSync(a.path, 'utf8');
    const before = s.length;
    s = s.replace(/__insertCSS\("(?:[^"\\]|\\.)*"\);/, '/* sonner CSS ships as /vendor/sonner/sonner.css */');
    if (s.length === before) throw new Error('insertCSS call not found');
    return { contents: s, loader: 'js' };
  });
} };
await esbuild.build({ entryPoints: ['toaster.jsx'], bundle: true, format: 'esm', minify: true, target: 'es2020', outfile: 'out/toaster.js',
  define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'eof', plugins: [noInsertCSS], metafile: true }).then((r) => console.log(Object.keys(r.metafile.inputs).filter((k) => !k.includes('scheduler')).length, 'inputs'));
