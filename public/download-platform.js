export const releaseUrl = 'https://github.com/zjwandcat/cute-fish-stock-picker/releases/latest';
export const downloads = {
  windows: { label: '下载 Windows 10 / 11 版', url: `${releaseUrl}/download/cute-fish-stock-picker-windows.zip` },
  macos: { label: '下载 macOS 版', url: `${releaseUrl}/download/cute-fish-stock-picker-macos.zip` },
  other: { label: '选择下载版本', url: './download.html' },
};

/** Windows 10 and 11 share the same browser UA and the same x64 package. */
export function detectPlatform(userAgent, maxTouchPoints = 0) {
  if (/iPhone|iPad|iPod|Android/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)) return 'other';
  if (/Windows/i.test(userAgent)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'macos';
  return 'other';
}
