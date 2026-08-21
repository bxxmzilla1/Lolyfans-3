import "server-only";

async function runFfmpeg(args: string[], timeout = 45000): Promise<void> {
  const ffmpegPath = (await import("ffmpeg-static")).default as unknown as
    | string
    | null;
  if (!ffmpegPath) throw new Error("ffmpeg binary not available");
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  await promisify(execFile)(ffmpegPath, args, { timeout });
}

/** One clear frame from a video — used for grid thumbnails.
 *  `input` is a local file path or an https URL. */
export async function videoFrameFromInput(input: string): Promise<Buffer> {
  const fs = await import("fs/promises");
  const os = await import("os");
  const path = await import("path");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vid-thumb-"));
  try {
    const outFile = path.join(dir, "out.jpg");
    await runFfmpeg(["-y", "-i", input, "-frames:v", "1", outFile]);
    return await fs.readFile(outFile);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
