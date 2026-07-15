export function inferProjectPathFromPageUrl(pageUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(pageUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "file:") {
    return null;
  }

  const decodedPath = decodeURIComponent(url.pathname);
  const lastSlashIndex = decodedPath.lastIndexOf("/");
  if (lastSlashIndex <= 0) {
    return null;
  }

  return decodedPath.slice(0, lastSlashIndex);
}
