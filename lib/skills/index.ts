// Skill system entry point
export * from './types';
export * from './loader';
export * from './tool';

// Singleton skill loader instance
import { SkillLoader } from './loader';
import { createSkillTool } from './tool';

export const skillLoader = new SkillLoader(process.env.SKILLS_DIR || './skills', true);

// Initialize skills on module load
if (typeof window === 'undefined') {
  skillLoader.discoverSkills().catch(console.error);
}