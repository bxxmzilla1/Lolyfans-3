/** Local smoke test of the ffmpeg wordmark overlay used in tgDeliverMedia. */
import sharp from "sharp";
import ffmpegPath from "ffmpeg-static";
import { execFileSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";

const src = readFileSync("src/lib/badgeAssets.ts", "utf8");
const WORDMARK = JSON.parse(src.match(/WORDMARK = ([\s\S]*?);\n$/)[1]);

const mark = await sharp(Buffer.from(WORDMARK.b64, "base64"))
  .resize(380, Math.round((WORDMARK.h / WORDMARK.w) * 380))
  .png()
  .toBuffer();
writeFileSync("scripts/test-mark.png", mark);

const markRatio = WORDMARK.h / WORDMARK.w;
execFileSync(ffmpegPath, [
  "-y",
  "-f", "lavfi", "-i", "testsrc2=size=720x1280:duration=2:rate=24",
  "-i", "scripts/test-mark.png",
  "-filter_complex",
  "[0:v]scale=trunc(iw/2)*2:trunc(ih/2)*2[v0];" +
    `[1:v][v0]scale2ref=w=main_w*0.26:h=main_w*0.26*${markRatio}[wm][base];` +
    "[base][wm]overlay=W*0.035:W*0.035",
  "-c:v", "libx264",
  "-preset", "veryfast",
  "-crf", "23",
  "-pix_fmt", "yuv420p",
  "-c:a", "aac",
  "-b:a", "160k",
  "-movflags", "+faststart",
  "scripts/test-watermark.mp4",
]);
execFileSync(ffmpegPath, [
  "-y", "-i", "scripts/test-watermark.mp4",
  "-frames:v", "1", "scripts/test-watermark-frame.jpg",
]);
console.log("wrote scripts/test-watermark-frame.jpg");
