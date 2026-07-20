/**
 * PUT a file to a Supabase signed upload URL, reporting 0–100 progress.
 */
export function uploadWithProgress(
  signedUrl: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signedUrl);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable || !onProgress) return;
      onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
      } else {
        let message = xhr.responseText || `Upload failed (${xhr.status})`;
        try {
          const parsed = JSON.parse(xhr.responseText) as {
            message?: string;
            error?: string;
            statusCode?: string | number;
          };
          if (String(parsed.statusCode) === "413" || /too large|maximum allowed size/i.test(message)) {
            message =
              "File is too large for Storage. In Supabase → Storage → Settings, raise the Global file size limit (Free max 50 MB; Pro up to 500 GB).";
          } else if (parsed.message) {
            message = parsed.message;
          } else if (parsed.error) {
            message = parsed.error;
          }
        } catch {
          // keep raw response
        }
        reject(new Error(message));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new Error("Upload cancelled"));
    xhr.send(file);
  });
}
