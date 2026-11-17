import { AIDER_DESK_COMMUNITY_EXTENSIONS_REPO_URLS, AIDER_DESK_EXTENSIONS_REPO_URL } from '@common/extensions';

export enum ExtensionSource {
  Official = 'official',
  Community = 'community',
  Custom = 'custom',
}

export enum ExtensionSourceFilter {
  All = 'all',
  Official = 'official',
  Community = 'community',
  Custom = 'custom',
}

// Accent color (CSS variable) used for the source dot/badge of each source.
export const SOURCE_ACCENT_VAR: Record<ExtensionSource, string> = {
  [ExtensionSource.Official]: 'var(--color-success)',
  [ExtensionSource.Community]: 'var(--color-agent-power-tools)',
  [ExtensionSource.Custom]: 'var(--color-button-primary)',
};

export const getExtensionSource = (repositoryUrl: string): ExtensionSource => {
  if (repositoryUrl === AIDER_DESK_EXTENSIONS_REPO_URL) {
    return ExtensionSource.Official;
  }
  if (AIDER_DESK_COMMUNITY_EXTENSIONS_REPO_URLS.includes(repositoryUrl)) {
    return ExtensionSource.Community;
  }
  return ExtensionSource.Custom;
};

export const isCustomRepository = (repositoryUrl: string): boolean => getExtensionSource(repositoryUrl) === ExtensionSource.Custom;

export const matchesSourceFilter = (source: ExtensionSource, filter: ExtensionSourceFilter): boolean =>
  filter === ExtensionSourceFilter.All || (filter as string) === (source as string);

// Format a repository URL into a compact display name (org/repo for GitHub URLs).
export const formatRepositoryName = (url: string): string => {
  try {
    const urlObj = new URL(url);

    if (urlObj.hostname === 'github.com' || urlObj.hostname === 'www.github.com') {
      const path = urlObj.pathname.replace(/^\/+|\/+$/g, '');
      const cleanPath = path.replace(/\.git$/, '');
      const segments = cleanPath.split('/');
      if (segments.length >= 2) {
        return `${segments[0]}/${segments[1]}`;
      }
      return cleanPath || url;
    }

    return url;
  } catch {
    return url;
  }
};
