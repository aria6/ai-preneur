/**
 * Google Drive URLs for publicly shared files. File IDs come from our API
 * (validated to [A-Za-z0-9_-]), but are still encoded defensively.
 */
export function driveThumbnailUrl(fileId: string, width = 320): string {
  return `https://drive.google.com/thumbnail?id=${encodeURIComponent(fileId)}&sz=w${width}`;
}

/** Embeddable Drive video player. */
export function drivePreviewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/preview`;
}

export function driveViewUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`;
}
