import 'dotenv/config';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = resolve(__dirname, 'script.json');
const AUDIO_DIR = resolve(__dirname, 'audio');

const API_KEY = process.env.ELEVENLABS_API_KEY;
if (!API_KEY) {
  console.error('Missing ELEVENLABS_API_KEY in demo/.env');
  process.exit(1);
}

const script = JSON.parse(await readFile(SCRIPT_PATH, 'utf8'));
const voiceId = process.env.ELEVENLABS_VOICE_ID || script.voiceId;
const model = script.model || 'eleven_turbo_v2_5';
const voiceSettings = script.voiceSettings || {};

if (!existsSync(AUDIO_DIR)) await mkdir(AUDIO_DIR, { recursive: true });

const FORCE = process.argv.includes('--force');
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];

console.log(`Voice: ${voiceId}`);
console.log(`Model: ${model}`);
console.log(`Beats: ${script.beats.length}${ONLY ? ` (filtered: ${ONLY})` : ''}`);

let totalChars = 0;
const beats = ONLY ? script.beats.filter((b) => b.id === ONLY) : script.beats;

for (const beat of beats) {
  const out = resolve(AUDIO_DIR, `${beat.id}.mp3`);
  if (existsSync(out) && !FORCE) {
    console.log(`  skip ${beat.id} (exists; pass --force to regenerate)`);
    continue;
  }
  totalChars += beat.narration.length;
  process.stdout.write(`  gen  ${beat.id} (${beat.narration.length} chars)... `);

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: beat.narration,
        model_id: model,
        voice_settings: voiceSettings,
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    console.error(`\nERROR ${res.status}: ${body}`);
    process.exit(1);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(out, buf);
  console.log(`${(buf.length / 1024).toFixed(1)} KB`);
}

console.log(`\nDone. ${totalChars} characters generated.`);
