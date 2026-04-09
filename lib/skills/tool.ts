// Skill Tool - creates the tool schema for agent tool calling
import { buildSkillToolSchema } from './loader';
import type { SkillMetadata } from './types';

export function createSkillTool(skills: SkillMetadata[]) {
  const toolSchema = buildSkillToolSchema(skills);

  if (!toolSchema) {
    return null;
  }

  return {
    ...toolSchema,
  };
}