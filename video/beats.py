import sys, json, subprocess, numpy as np
# Usage: python3 beats.py track.mp3 [min_bpm max_bpm]   -> JSON with bpm, beat, first_downbeat, energetic_downbeat
p = sys.argv[1]; lo = float(sys.argv[2]) if len(sys.argv) > 2 else 90; hi = float(sys.argv[3]) if len(sys.argv) > 3 else 150; sr = 22050; hop = 128; n = 1024
x = np.frombuffer(subprocess.run(["ffmpeg","-v","error","-i",p,"-ac","1","-ar",str(sr),"-f","f32le","-"], capture_output=True).stdout, dtype=np.float32)
fr = np.lib.stride_tricks.sliding_window_view(x, n)[::hop] * np.hanning(n)
mag = np.abs(np.fft.rfft(fr, axis=1))
low = mag[:, :int(150 * n / sr)]  # kick region
flux = np.maximum(0, np.diff(np.log1p(mag), axis=0)).sum(1)
kick = np.maximum(0, np.diff(np.log1p(low), axis=0)).sum(1)
fps = sr / hop
# tempo: scan BPM lo..hi in 0.1 steps with a comb over 60s
seg = flux[: int(fps * 60)]
def score(b):
    per = 60 * fps / b
    best = 0
    for ph in np.linspace(0, per, 32, endpoint=False):
        idx = (ph + per * np.arange(int(len(seg) / per) - 1)).astype(int)
        best = max(best, seg[idx].mean())
    return best
bpms = np.arange(lo, hi, 0.1)
sc = np.array([score(b) for b in bpms])
bpm = bpms[sc.argmax()]
per = 60 * fps / bpm
# phase from kick energy, then pick the downbeat (strongest of 4 phases)
phs = np.linspace(0, per, 64, endpoint=False)
ph = phs[np.argmax([kick[(q + per * np.arange(int(len(kick) / per) - 1)).astype(int)].mean() for q in phs])]
beats = (ph + per * np.arange(int((len(flux) - ph) / per))) / fps
bars = [kick[(np.array([beats[i] for i in range(k, len(beats), 4)]) * fps).astype(int)].mean() for k in range(4)]
down = int(np.argmax(bars))
first = beats[down]
# first downbeat after the intro gets loud
env = np.convolve(np.abs(x), np.ones(sr) / sr, "same")[::sr]
loud_from = int(np.argmax(env > 0.6 * env.max()))
start = next(b for b in beats[down::4] if b >= loud_from - 0.01)
print(json.dumps({"file": p, "bpm": round(float(bpm), 2), "beat": round(60 / float(bpm), 4), "first_downbeat": round(float(first), 3), "energetic_downbeat": round(float(start), 3), "duration": round(len(x) / sr, 1)}))
