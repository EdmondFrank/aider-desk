/* eslint-disable @typescript-eslint/no-explicit-any */
import { SettingsData } from '@common/types';

const OLD_DEFAULT_REPO_PREFIX = 'https://github.com/hotovo/aider-desk';
const NEW_DEFAULT_REPO_PREFIX = 'https://github.com/magiksoft/aider-desk';

export const migrateSettingsV22toV23 = (settings: any): SettingsData => {
  const repositories: string[] | undefined = settings.extensions?.repositories;

  if (!repositories) {
    return settings;
  }

  return {
    ...settings,
    extensions: {
      ...settings.extensions,
      repositories: repositories.map((repo) => (repo.startsWith(OLD_DEFAULT_REPO_PREFIX) ? repo.replace(OLD_DEFAULT_REPO_PREFIX, NEW_DEFAULT_REPO_PREFIX) : repo)),
    },
  };
};
