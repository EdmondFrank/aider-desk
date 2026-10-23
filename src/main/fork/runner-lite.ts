import { normalizeBaseDir } from '@common/utils';
import { ProjectData } from '@common/types';

import logger from '@/logger';
import { initManagers } from '@/managers';
import { Store } from '@/store';
import { AIDER_DESK_DATA_DIR, READONLY_MODE, SERVER_PORT } from '@/constants';
import { getDefaultProjectSettings } from '@/utils';
import { ModelManager } from '@/models';
import { AgentProfileManager } from '@/agent';

// Fork-only entry point: a lean web server that skips the Python/Aider bootstrap
// and disables heavyweight subsystems (memory embeddings) that are unused here.

const addProjectsFromEnv = async (store: Store, modelManager: ModelManager, agentProfileManager: AgentProfileManager): Promise<void> => {
  const aiderDeskProjectsEnv = process.env.AIDER_DESK_PROJECTS;
  if (!aiderDeskProjectsEnv) {
    if (READONLY_MODE) {
      throw new Error('AIDER_DESK_PROJECTS must contain at least one project when readonly mode is enabled.');
    }
    return;
  }

  const projectPaths = aiderDeskProjectsEnv
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (projectPaths.length === 0) {
    if (READONLY_MODE) {
      throw new Error('AIDER_DESK_PROJECTS must contain at least one project when readonly mode is enabled.');
    }
    return;
  }

  logger.info('AIDER_DESK_PROJECTS environment variable found', { projectPaths });

  const openProjects = store.getOpenProjects();
  const projectsFromEnv: ProjectData[] = [];

  for (const projectPath of projectPaths) {
    const providerModels = await modelManager.getProviderModels();
    const defaultAgentProfileId = agentProfileManager.getDefaultAgentProfileId();

    projectsFromEnv.push({
      baseDir: projectPath.endsWith('/') ? projectPath.slice(0, -1) : projectPath,
      settings: getDefaultProjectSettings(store, providerModels.models || [], projectPath, defaultAgentProfileId, modelManager.getProviders()),
      active: false,
    });
  }

  if (projectsFromEnv.length > 0) {
    const normalizedOpenProjects = openProjects.map((p) => normalizeBaseDir(p.baseDir));

    projectsFromEnv.forEach((project) => {
      const existingIndex = normalizedOpenProjects.indexOf(normalizeBaseDir(project.baseDir));
      if (existingIndex >= 0) {
        project.active = openProjects[existingIndex].active;
      }
    });

    if (!projectsFromEnv.some((p) => p.active)) {
      projectsFromEnv[0].active = true;
    }

    store.setOpenProjects(projectsFromEnv);
    logger.info(`Overridden open projects with ${projectsFromEnv.length} project(s) from AIDER_DESK_PROJECTS`);
  }
};

const disableMemory = (store: Store): void => {
  const settings = store.getSettings();
  if (settings.memory.enabled && process.env.AIDER_DESK_MEMORY_ENABLED !== 'true') {
    store.saveSettings({ ...settings, memory: { ...settings.memory, enabled: false } });
    logger.info('Lite profile: memory embeddings disabled (set AIDER_DESK_MEMORY_ENABLED=true to enable)');
  }
};

const main = async (): Promise<void> => {
  process.env.AIDER_DESK_HEADLESS = 'true';

  logger.info('------------ Starting AiderDesk Lite (web server) ------------');

  const store = new Store();
  await store.init(AIDER_DESK_DATA_DIR);

  disableMemory(store);

  const { modelManager, agentProfileManager, projectManager, serverController } = await initManagers(store);

  try {
    await addProjectsFromEnv(store, modelManager, agentProfileManager);

    if (READONLY_MODE) {
      const configuredProjects =
        process.env.AIDER_DESK_PROJECTS?.split(',')
          .map((project) => project.trim())
          .filter(Boolean) ?? [];
      if (configuredProjects.length === 0) {
        throw new Error('AIDER_DESK_PROJECTS must contain at least one project in readonly mode');
      }
      const projects = store.getOpenProjects();
      await Promise.all(projects.map((project) => projectManager.startProject(project.baseDir)));
      serverController.setReadonlyReady();
    }

    logger.info(`AiderDesk Lite is ready at http://localhost:${SERVER_PORT}`);
  } catch (error) {
    logger.error('Failed to start AiderDesk Lite:', error);
    process.exit(1);
  }
};

if (!process.env.VITEST) {
  main().catch((error) => {
    logger.error('Unhandled error in main:', error);
    process.exit(1);
  });
}
