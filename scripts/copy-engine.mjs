// Oyun motorunu Edge Function klasörüne kopyalar (Deno için .ts uzantılı importlar)
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const src = 'src/engine', dst = 'supabase/functions/game71/engine';
mkdirSync(dst, { recursive: true });
for (const f of readdirSync(src)) {
  if (!f.endsWith('.ts') || f === 'runner.ts') continue;
  const code = readFileSync(`${src}/${f}`, 'utf8').replace(/from '(\.\/[a-z]+)'/g, "from '$1.ts'");
  writeFileSync(`${dst}/${f}`, `// Bu dosya src/engine'den otomatik kopyalanır; burada düzenlemeyin.\n${code}`);
}
console.log('engine kopyalandı');
