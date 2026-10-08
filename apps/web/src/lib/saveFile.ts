/**
 * Hands a file to the browser as a download. What happens next (save it, offer to open it with a calendar app) is
 * up to the browser and the operating system: the product does not try to guess which app the student uses.
 */
export function saveFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Not revoked at once: some browsers read the blob a moment after the click.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
