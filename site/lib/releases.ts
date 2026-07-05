export type Platform = "mac" | "windows" | "linux";

export type ReleaseAsset = {
  label: string;
  detail: string;
  url: string;
  sizeMb: string;
};

export type LatestRelease = {
  version: string;
  assets: Record<Platform, ReleaseAsset[]>;
};

const API_URL = "https://api.github.com/repos/HarshBti1805/OpenScene/releases/latest";

/* Maps a release asset filename to a platform + human label.
   Returns null for artifacts that aren't user installers (updater
   bundles, signatures, checksums). */
function classify(name: string): { platform: Platform; label: string; detail: string } | null {
  const lower = name.toLowerCase();
  const isArm = /aarch64|arm64/.test(lower);
  const isX64 = /x64|x86_64|amd64/.test(lower);
  const arch = isArm ? "Apple Silicon" : isX64 ? "Intel" : "";

  if (lower.endsWith(".dmg")) {
    return { platform: "mac", label: arch || "macOS", detail: ".dmg" };
  }
  if (lower.endsWith(".msi")) {
    return { platform: "windows", label: "Installer", detail: ".msi" };
  }
  if (lower.endsWith(".exe")) {
    return { platform: "windows", label: "Setup", detail: ".exe" };
  }
  if (lower.endsWith(".appimage")) {
    return { platform: "linux", label: "Portable", detail: ".AppImage" };
  }
  if (lower.endsWith(".deb")) {
    return { platform: "linux", label: "Debian / Ubuntu", detail: ".deb" };
  }
  if (lower.endsWith(".rpm")) {
    return { platform: "linux", label: "Fedora / RHEL", detail: ".rpm" };
  }
  return null;
}

export async function fetchLatestRelease(): Promise<LatestRelease | null> {
  try {
    const res = await fetch(API_URL, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      tag_name?: string;
      assets?: { name: string; size: number; browser_download_url: string }[];
    };
    const grouped: Record<Platform, ReleaseAsset[]> = { mac: [], windows: [], linux: [] };
    for (const asset of data.assets ?? []) {
      const kind = classify(asset.name);
      if (!kind) continue;
      grouped[kind.platform].push({
        label: kind.label,
        detail: kind.detail,
        url: asset.browser_download_url,
        sizeMb: `${(asset.size / 1024 / 1024).toFixed(1)} MB`,
      });
    }
    if (!grouped.mac.length && !grouped.windows.length && !grouped.linux.length) return null;
    return { version: data.tag_name ?? "", assets: grouped };
  } catch {
    return null;
  }
}
