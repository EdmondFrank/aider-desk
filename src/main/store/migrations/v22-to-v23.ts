/* eslint-disable @typescript-eslint/no-explicit-any */
import { SettingsData } from '@common/types';
import { AIDER_DESK_COMMUNITY_EXTENSIONS_REPO_URLS, AIDER_DESK_EXTENSIONS_REPO_URL } from '@common/extensions';

const OLD_DEFAULT_REPO_PREFIX = 'https://github.com/hotovo/aider-desk';

export const migrateSettingsV22toV23 = (settings: any): SettingsData => {
  const repositories: string[] | undefined = settings.extensions?.repositories;

  if (!repositories) {
    return settings;
  }

  // Official and community repos are no longer stored in settings — they are merged in at
  // read time via getExtensionRepositories. Only user-added custom repos are persisted.
  // The old official repo prefix (hotovo) is dropped along with the current one.
  const customRepositories = repositories.filter(
    (repo) => !repo.startsWith(OLD_DEFAULT_REPO_PREFIX) && repo !== AIDER_DESK_EXTENSIONS_REPO_URL && !AIDER_DESK_COMMUNITY_EXTENSIONS_REPO_URLS.includes(repo),
  );

  return {
    ...settings,
    extensions: {
      disabled: settings.extensions?.disabled ?? [],
      customRepositories,
    },
  };
};
