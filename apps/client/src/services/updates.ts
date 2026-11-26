/**
 * Procura versões novas do app de desktop nos Releases do GitHub.
 *
 * Não baixa nem instala nada sozinho: mostra um aviso com o link para baixar o
 * instalador. Instalar sem uma assinatura conferida seria arriscado.
 */
import { UPDATE_REPO } from '../lib/config';
import { getAppVersion, isDesktop } from '../lib/desktop';
import { useAppStore, type UpdateInfo } from '../store/useAppStore';

function parseVersion(text: string): number[] {
  return text
    .replace(/^v/i, '')
    .split(/[.-]/)
    .slice(0, 3)
    .map((part) => Number.parseInt(part, 10) || 0);
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

interface GithubRelease {
  tag_name: string;
  html_url: string;
  draft: boolean;
  assets: Array<{ name: string; browser_download_url: string }>;
}

export async function checkForUpdates(manual = false): Promise<UpdateInfo | null> {
  if (!isDesktop) return null;
  const current = await getAppVersion();
  if (!current) return null;
  try {
    const response = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) return null;
    const release = (await response.json()) as GithubRelease;
    if (release.draft || !isNewerVersion(release.tag_name, current)) {
      if (manual) useAppStore.getState().setUpdateInfo(null);
      return null;
    }
    const installer = release.assets.find((a) => /setup\.exe$|\.exe$/i.test(a.name));
    const info: UpdateInfo = {
      version: release.tag_name.replace(/^v/i, ''),
      url: installer?.browser_download_url ?? release.html_url,
    };
    useAppStore.getState().setUpdateInfo(info);
    return info;
  } catch {
    return null;
  }
}
