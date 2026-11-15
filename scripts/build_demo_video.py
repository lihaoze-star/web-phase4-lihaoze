"""Build the 2-minute Task 06 demo video from CDP frames and title cards."""

import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TMP = ROOT / ".tmp" / "demo-video"
FFMPEG = ROOT / "tools" / "ffmpeg.exe"

FPS = 10
SLOW = 2.0
CARD_SECONDS = {"intro": 12, "tech": 22, "pitfalls": 20}


def run(args):
    print("ffmpeg", " ".join(str(a) for a in args[3:]))
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def encode_card(name, seconds):
    source = ROOT / "docs" / "screenshots" / f"demo-{name}.png"
    target = TMP / f"{name}.mp4"
    run([
        str(FFMPEG), "-y", "-loop", "1", "-framerate", "30", "-t", str(seconds),
        "-i", str(source), "-vf", "scale=1280:800,format=yuv420p",
        "-r", "30", "-c:v", "libx264", "-crf", "22", "-preset", "medium",
        "-movflags", "+faststart", str(target),
    ])
    return target


def build_live():
    manifest = json.loads((ROOT / ".tmp" / "demo-frames" / "manifest.json").read_text(encoding="utf-8"))
    frames = manifest["frames"]
    start = frames[0]["time"]
    end = manifest["endTime"]
    duration = (end - start) / 1000 * SLOW
    out_dir = TMP / "live"
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)

    total = int(duration * FPS)
    cursor = 0
    for index in range(total):
        real_ms = start + (index / FPS) / SLOW * 1000
        while cursor + 1 < len(frames) and frames[cursor + 1]["time"] <= real_ms:
            cursor += 1
        shutil.copyfile(
            ROOT / ".tmp" / "demo-frames" / frames[cursor]["file"],
            out_dir / f"frame-{index + 1:05d}.jpg",
        )

    target = TMP / "live.mp4"
    run([
        str(FFMPEG), "-y", "-framerate", str(FPS),
        "-i", str(out_dir / "frame-%05d.jpg"),
        "-vf", "fps=30,format=yuv420p", "-r", "30",
        "-c:v", "libx264", "-crf", "22", "-preset", "medium",
        "-movflags", "+faststart", str(target),
    ])
    print(f"live: {total} frames, {duration:.1f}s")
    return target


def main():
    TMP.mkdir(parents=True, exist_ok=True)
    parts = [encode_card("intro", CARD_SECONDS["intro"]), build_live()]
    parts += [encode_card("tech", CARD_SECONDS["tech"]), encode_card("pitfalls", CARD_SECONDS["pitfalls"])]

    concat = TMP / "concat.txt"
    concat.write_text("".join(f"file '{part.as_posix()}'\n" for part in parts), encoding="utf-8")
    output = ROOT / "docs" / "demo.mp4"
    run([
        str(FFMPEG), "-y", "-f", "concat", "-safe", "0", "-i", str(concat),
        "-c", "copy", "-movflags", "+faststart", str(output),
    ])
    size = output.stat().st_size / 1024 / 1024
    print(f"demo.mp4: {size:.2f} MB")


if __name__ == "__main__":
    main()
