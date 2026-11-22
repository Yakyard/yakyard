# Adds the voiceover to the tour video (docs/media/yakyard-demo.mp4) with Kokoro-82M (Apache-2.0), stock voice af_heart.
# Each line starts at its scene. While the demo's voice note plays (16.6 s to 30.8 s), nobody talks over it:
# the note's own sound from the recording is kept there, and only there. The phone scene's replay of the note is
# left out so it never meets the narration. The closing card is held a few seconds longer so the last line fits.
# Run with Python 3.12: pip install torch kokoro soundfile (needs espeak-ng and ffmpeg).
#   python site/tools/tour_voiceover.py SILENT_TOUR.mp4   -> docs/media/yakyard-demo.mp4 and site/static/media/yakyard-demo.mp4
# SILENT_TOUR.mp4 is the captioned tour as recorded; its audio track holds the demo voice note.
import os, sys, json, shutil, subprocess, numpy as np, soundfile as sf
from kokoro import KPipeline
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, "..", "..")
SRC = sys.argv[1]
TMP = "/tmp/tourvo/"; os.makedirs(TMP, exist_ok=True)
VOICE, SPEED, SR = "af_heart", 0.95, 24000
NOTE = (16.2, 31.0)  # the demo voice note in the recording, with a little air on each side
# (start in seconds, line, scene it must end in)
lines = [
  (0.5, "This is Yakyard.", 3.6),
  (4.0, "Here's the live demo. One click and you're in. No signup, no email.", 11.0),
  (11.8, "This is the launch channel. Tomas left a voice note.", NOTE[0]),
  (31.6, "Every voice note gets a written transcript, for when you can't listen. Replies go in a thread, so the channel stays tidy.", 42.7),
  (43.6, "Reactions work the way you'd expect. One click.", 50.1),
  (50.9, "Search for glaze, and it finds the voice note too.", 56.1),
  (56.9, "Three themes: light, dark, and this bold one. Everyone picks their own.", 66.3),
  (67.0, "Same channel on a phone. Install it from the browser, notifications included. No app store.", 75.0),
  (75.3, "Free, open source, on your own Cloudflare account or your own server. GitHub, yakyard slash yakyard.", None),
]
pipe = KPipeline(lang_code="a")
srcdur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", SRC], capture_output=True, text=True).stdout)
total = srcdur
track = np.zeros(int((srcdur + 15) * SR), np.float32)
report = []
for start, text, until in lines:
    a = np.concatenate([r.audio.numpy() for r in pipe(text, voice=VOICE, speed=SPEED)])
    end = start + len(a) / SR
    if until is not None and end > until - 0.15:
        sys.exit(f"too long for its scene: {text!r} ends at {end:.2f}, scene ends at {until}")
    i = int(start * SR); track[i:i + len(a)] += a
    total = max(total, end + 1.6)
    report.append([round(start, 2), round(end, 2), text])
track = track[: int(total * SR)]
sf.write(TMP + "narration.wav", track, SR)
hold = total - srcdur
# the voice note from the recording, faded in and out at its edges, at its own place in time
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", SRC, "-vn", "-ac", "1", "-ar", str(SR),
  "-af", f"atrim={NOTE[0]}:{NOTE[1]},asetpts=PTS-STARTPTS,afade=t=in:d=0.15,afade=t=out:st={NOTE[1]-NOTE[0]-0.4}:d=0.4,adelay={int(NOTE[0]*1000)},apad=whole_dur={total}",
  TMP + "note.wav"], check=True)
# the note is a phone recording, the narration a studio voice: level them, then mix (they never overlap)
def lufs(p):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", p, "-af", "ebur128", "-f", "null", "-"], capture_output=True, text=True)
    return float([l for l in r.stderr.splitlines() if l.strip().startswith("I:")][-1].split()[1])
for n in ("narration", "note"):
    seg = TMP + n + ".wav"
    g = -18 - lufs(seg)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", seg, "-af", f"volume={g:.2f}dB", TMP + n + ".lv.wav"], check=True)
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", TMP + "narration.lv.wav", "-i", TMP + "note.lv.wav",
  "-filter_complex", "amix=inputs=2:normalize=0,highpass=f=60", "-ar", "48000", TMP + "mix.wav"], check=True)
# about -16 LUFS: linear gain plus a limiter, measured and corrected three times (one-pass loudnorm pumps on speech with gaps)
gain = -16 - lufs(TMP + "mix.wav")
for _ in range(3):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", TMP + "mix.wav", "-af", f"volume={gain:.2f}dB,alimiter=limit=0.84:attack=2:release=80:level=false", TMP + "final.wav"], check=True)
    gain += -16 - lufs(TMP + "final.wav")
# same picture, the last frame held for the closing line; H.264, AAC, faststart
out = TMP + "yakyard-demo.mp4"
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", SRC, "-i", TMP + "final.wav", "-map", "0:v", "-map", "1:a",
  "-vf", f"tpad=stop_mode=clone:stop_duration={hold:.3f}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "1", "-t", f"{total:.3f}", "-movflags", "+faststart", out], check=True)
for dst in ("docs/media/yakyard-demo.mp4", "site/static/media/yakyard-demo.mp4"):
    shutil.copy(out, os.path.join(ROOT, dst))
print(json.dumps({"duration": round(total, 2), "lufs": lufs(TMP + "final.wav"), "lines": report}, indent=1))
