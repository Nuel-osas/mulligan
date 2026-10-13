// ElevenLabs narration, one file per scene, and the real measured durations (build the cut to these, never to estimates).
// Usage: ELEVENLABS_API_KEY=... node tts.mjs narration.txt [voiceId] [modelId]
//   narration.txt lines: s1|Text for scene one.
//   writes s1.mp3 ... and durations.txt ("s1 3.30")
// Default voice: Brian (nPczCjzI2devNBz1zQrb), model eleven_multilingual_v2. A restricted key with TTS permission is enough.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
const [file = "narration.txt", voice = "nPczCjzI2devNBz1zQrb", model = "eleven_multilingual_v2"] = process.argv.slice(2);
const key = process.env.ELEVENLABS_API_KEY; if (!key) throw new Error("set ELEVENLABS_API_KEY");
const dir = dirname(resolve(file)); const out = [];
for (const line of readFileSync(file, "utf8").split("\n").filter((l) => l.includes("|"))) {
  const [id, text] = line.split(/\|(.*)/s);
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: "POST", headers: { "xi-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({ text: text.trim(), model_id: model, voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.2 } }),
  });
  if (!r.ok) throw new Error(`${id}: ${r.status} ${await r.text()}`);
  writeFileSync(`${dir}/${id}.mp3`, Buffer.from(await r.arrayBuffer()));
  const d = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", `${dir}/${id}.mp3`]).toString());
  out.push(`${id} ${d.toFixed(2)}`); console.log(id, d.toFixed(2), "s");
}
writeFileSync(`${dir}/durations.txt`, out.join("\n") + "\n");
