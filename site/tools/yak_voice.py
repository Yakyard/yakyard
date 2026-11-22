# Makes the yak's voice clips for the website with Kokoro-82M (Apache-2.0), stock voice am_puck.
# Run with Python 3.12: pip install torch kokoro soundfile (needs espeak-ng and ffmpeg).
#   python site/tools/yak_voice.py   -> site/static/audio/*.webm|mp3 and site/src/voice.json
import json, sys, os, subprocess, numpy as np, soundfile as sf
from kokoro import KPipeline
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "static", "audio") + "/"
TMP = "/tmp/"
VOICE = sys.argv[1] if len(sys.argv) > 1 else "am_puck"
PITCH = 1.05   # pitch up 5%
TEMPO = 1.0    # net speed after pitch shift
lines = {
  "note": "Quick one from the yard. The new homepage is live. Same channels, same threads, and the bill is still zero. Have a listen, then yak back.",
  "hi-1": "Yak all you want. Pay nobody.",
  "hi-2": "Quiet in here. Say something.",
  "hi-3": "Zero dollars a seat. I checked.",
  "hi-4": "Your chat lives on your account. Not mine.",
  "egg": "Okay, okay. I'm a yak, not a doorbell.",
}
pipe = KPipeline(lang_code="a")
out = {}
for key, text in lines.items():
    audio, words, t0 = [], [], 0.0
    for r in pipe(text, voice=VOICE, speed=1.0):
        a = r.audio.numpy() if hasattr(r.audio, "numpy") else np.asarray(r.audio)
        for tk in (r.tokens or []):
            if tk.start_ts is not None and tk.text.strip() and any(c.isalnum() for c in tk.text):
                words.append([tk.text, round(t0 + tk.start_ts, 3)])
        audio.append(a); t0 += len(a) / 24000
    a = np.concatenate(audio)
    sf.write(TMP + f"{key}.wav", a, 24000)
    # pitch up via asetrate, then atempo so the net speed is TEMPO
    af = f"asetrate={int(24000*PITCH)},aresample=24000,atempo={TEMPO/PITCH:.4f},highpass=f=70,loudnorm=I=-16:TP=-1.5"
    for ext, codec in [("webm", ["-c:a", "libopus", "-b:a", "24k", "-application", "voip"]), ("mp3", ["-c:a", "libmp3lame", "-b:a", "32k", "-ar", "22050"])]:
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", TMP + f"{key}.wav", "-af", af, "-ac", "1", *codec, OUT + f"{key}.{ext}"], check=True)
    scale = 1 / TEMPO
    dur = len(a) / 24000 * scale
    entry = {"text": text, "dur": round(dur, 2), "words": [[w, round(t * scale, 2)] for w, t in words]}
    if key == "note":
        n = 40; seg = np.array_split(np.abs(a), n)
        rms = np.array([np.sqrt((s.astype(float) ** 2).mean()) for s in seg]); rms = rms / rms.max()
        entry["bars"] = [round(float(max(0.18, v ** 0.7)), 2) for v in rms]
    out[key] = entry
json.dump(out, open(os.path.join(HERE, "..", "src", "voice.json"), "w"), indent=1)
print(json.dumps({k: (v["dur"], len(v["words"])) for k, v in out.items()}))
