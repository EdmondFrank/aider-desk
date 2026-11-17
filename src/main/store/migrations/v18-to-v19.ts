/* eslint-disable @typescript-eslint/no-explicit-any */
import { AIDER_DESK_EXTENSIONS_REPO_URL } from '@common/extensions';

export const migrateSettingsV18toV19 = (settings: any): any => {
  return {
    ...settings,
    extensions: {
      repositories: [AIDER_DESK_EXTENSIONS_REPO_URL],
      disabled: [],
    },
  };
};
