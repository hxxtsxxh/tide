// Run with --env-file=.env.local; only counts are printed, never values or matching content.
import { readdir, readFile } from 'node:fs/promises';
async function files(dir) { return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(e => e.isDirectory() ? files(dir + '/' + e.name) : [dir + '/' + e.name]))).flat(); }
const secrets = ['TAVILY_API_KEY', 'TELEM_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'RIPPLE_STATE_SECRET'].map(k => process.env[k]).filter(v => v && v.length >= 8);
let matches = 0;
const paths = await files('.next/static');
for (const path of paths) { const content = await readFile(path, 'utf8'); if (secrets.some(v => content.includes(v))) matches++; }
console.log(JSON.stringify({ filesScanned: paths.length, configuredSecretsChecked: secrets.length, matchingFiles: matches, passed: matches === 0 }));
process.exitCode = matches ? 1 : 0;
