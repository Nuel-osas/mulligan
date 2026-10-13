"""Compose the final film from video.json: motion open, framed footage scenes, motion close,
beat-length crossfades, narration per scene, music ducked under the voice, loudness-normalised.

Usage: python3 compose.py video.json      (run from the project's video folder)

video.json:
{
  "beat": 0.5,                                   # 60 / BPM
  "open":  {"file": "motion_open.mp4", "dur": 14.5, "voice": {"id": "s1", "at": 2.0}},
  "close": {"file": "motion_close.mp4", "hold": 2.5, "voice": {"id": "s9", "at": 1.4}},
  "scenes": [ {"id": "s2", "clip": "raw/s2.webm", "start": 5.26, "max_source": null}, ... ],
  "pad": 1.1,                                    # seconds of picture after each line of narration
  "max_speed": 2.0,                              # footage longer than the line is sped up, at most this much
  "music": {"file": "music/track.mp3", "offset": 0.133, "volume": 0.42},
  "out": "final.mp4"
}
Narration files are <id>.mp3 with lengths in durations.txt (from tts.mjs).
Scenes need plate_bg.png and plate_mask.png (from plates.mjs) in the same folder.
"""
import json, math, subprocess, sys

cfg = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "video.json"))
dur = {l.split()[0]: float(l.split()[1]) for l in open("durations.txt") if l.strip()}
probe = lambda f: float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]))
run = lambda a: subprocess.run(a, check=True)
BEAT = cfg.get("beat", 0.5)
X = BEAT * cfg.get("crossfade_beats", 1)
pad, max_speed = cfg.get("pad", 1.1), cfg.get("max_speed", 2.0)

segs = [(cfg["open"]["file"], cfg["open"]["dur"])]
for sc in cfg["scenes"]:
    s = sc["id"]
    D = math.ceil((dur[s] + pad) / BEAT) * BEAT          # whole beats: every cut lands on the grid
    a = sc.get("start", 0) + 0.2
    L = probe(sc["clip"]) - 0.35 - a
    if sc.get("max_source"): L = min(L, sc["max_source"])   # cut before something you must not show
    sp = min(max(1.0, L / D), max_speed)
    out = f"seg_{s}.mp4"
    run(["ffmpeg", "-v", "error", "-y", "-ss", f"{a:.3f}", "-i", sc["clip"], "-i", "plate_bg.png", "-i", "plate_mask.png", "-filter_complex",
         f"[0:v]trim=duration={L:.3f},setpts=(PTS-STARTPTS)/{sp:.4f},fps=30,scale=1600:900:flags=lanczos,tpad=stop_mode=clone:stop_duration=30,trim=duration={D},format=rgba[v];"
         f"[2:v]crop=1600:900:160:90,format=gray[m];[v][m]alphamerge[r];[1:v][r]overlay=160:90,format=yuv420p",
         "-t", str(D), "-r", "30", "-c:v", "libx264", "-crf", "17", out])
    print(f"{s}: {D:.1f}s, speed {sp:.2f}" + ("  (footage longer than max_speed allows: trimmed)" if L / D > max_speed else ""))
    segs.append((out, D))
hold = cfg["close"].get("hold", 2.5)
run(["ffmpeg", "-v", "error", "-y", "-i", cfg["close"]["file"], "-vf", f"tpad=stop_mode=clone:stop_duration={hold}", "-c:v", "libx264", "-crf", "16", "seg_close.mp4"])
segs.append(("seg_close.mp4", probe(cfg["close"]["file"]) + hold))

starts, acc = [], 0.0
for f, D in segs:
    starts.append(acc); acc += D - X
total = starts[-1] + segs[-1][1]

ins, fc, prev = [], [], "0:v"
for f, _ in segs: ins += ["-i", f]
for i in range(1, len(segs)):
    fc.append(f"[{prev}][{i}:v]xfade=transition=fade:duration={X}:offset={starts[i]:.3f}[x{i}]"); prev = f"x{i}"

vo = []
if cfg["open"].get("voice"): vo.append((cfg["open"]["voice"]["id"], cfg["open"]["voice"]["at"]))
vo += [(sc["id"], starts[k + 1] + 0.45) for k, sc in enumerate(cfg["scenes"])]
if cfg["close"].get("voice"): vo.append((cfg["close"]["voice"]["id"], starts[-1] + cfg["close"]["voice"]["at"]))
n0 = len(segs)
for j, (s, at) in enumerate(vo):
    ins += ["-i", f"{s}.mp3"]; ms = int(at * 1000)
    fc.append(f"[{n0 + j}:a]adelay={ms}|{ms},apad[n{j}]")
    nxt = vo[j + 1][1] if j + 1 < len(vo) else total
    if at + dur.get(s, 0) > nxt: print(f"WARNING: narration {s} overlaps the next line by {at + dur[s] - nxt:.2f}s")
fc.append("".join(f"[n{j}]" for j in range(len(vo))) + f"amix=inputs={len(vo)}:normalize=0,atrim=duration={total:.3f},asplit[vo][sc]")
m = cfg["music"]
ins += ["-ss", str(m.get("offset", 0)), "-i", m["file"]]
fc.append(f"[{n0 + len(vo)}:a]volume={m.get('volume', 0.42)},apad,atrim=duration={total:.3f},afade=t=in:d=0.3,afade=t=out:st={total - 3.5:.3f}:d=3.5[mu]")
fc.append("[mu][sc]sidechaincompress=threshold=0.03:ratio=8:attack=25:release=450[duck]")
fc.append(f"[duck][vo]amix=inputs=2:normalize=0,loudnorm=I={cfg.get('lufs', -14)}:TP=-1.5:LRA=11[a]")
out = cfg.get("out", "final.mp4")
run(["ffmpeg", "-v", "error", "-y", *ins, "-filter_complex", ";".join(fc), "-map", f"[{prev}]", "-map", "[a]",
     "-c:v", "libx264", "-crf", "18", "-preset", "slow", "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", out])
print(f"{out}: {total:.2f}s, scene starts {[round(s, 2) for s in starts]}")
if probe(m["file"]) - m.get("offset", 0) < total: print("NOTE: the music track is shorter than the film; it ends early")
