import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Dev-only helper: the bake tool (bake.html) posts its finished impostor atlases here and they are written to public/impostors.
const saveBaked = {
  name: 'save-baked-impostors',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__save', (req, res) => {
      const name = new URL(req.url, 'http://localhost').searchParams.get('name') || '';
      if (req.method !== 'POST' || !/^[a-z0-9_]+\.(png|json)$/.test(name)) { res.statusCode = 400; res.end('bad request'); return; }
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const dir = path.resolve(process.cwd(), 'public/impostors');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, name), Buffer.concat(chunks));
        res.end('ok');
      });
    });
  },
};

// Dev-only: screenshots posted by the page (game.capture) land in .shots/, for comparing looks while the preview pane is hidden.
const saveShots = {
  name: 'save-shots',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__shot', (req, res) => {
      const name = new URL(req.url, 'http://localhost').searchParams.get('name') || '';
      if (req.method !== 'POST' || !/^[a-z0-9_]+\.jpg$/.test(name)) { res.statusCode = 400; res.end('bad request'); return; }
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const dir = path.resolve(process.cwd(), '.shots'); fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, name), Buffer.concat(chunks)); res.end('ok');
      });
    });
  },
};

// the Unreal prototype in unreal/ holds tens of thousands of build files the dev server has no reason to watch
export default defineConfig({ plugins: [saveBaked, saveShots], server: { watch: { ignored: ['**/unreal/**', '**/.shots/**'] } } });
