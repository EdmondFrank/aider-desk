/* eslint-disable @typescript-eslint/no-explicit-any */
import { SettingsData } from '@common/types';
import { AIDER_DESK_COMMUNITY_EXTENSIONS_REPO_URLS } from '@common/extensions';

export const migrateSettingsV23toV24 = (settings: any): SettingsData => {
  const repositories: string[] | undefined = settings.extensions?.repositories;

  if (!repositories) {
    return settings;
  }

  const missingCommunityRepos = AIDER_DESK_COMMUNITY_EXTENSIONS_REPO_URLS.filter((url) => !repositories.includes(url));

  if (missingCommunityRepos.length === 0) {
    return settings;
  }

  return {
    ...settings,
    extensions: {
      ...settings.extensions,
      repositories: [...repositories, ...missingCommunityRepos],
    },
  };
};
