/**
 * Валидация ID скилла
 */
export function validateSkillId(skillId: string): boolean {
  if (!skillId || typeof skillId !== 'string') {
    return false;
  }

  // Проверка на directory traversal
  if (skillId.includes('..') || skillId.includes('/') || skillId.includes('\\')) {
    return false;
  }

  // Проверка на допустимые символы: буквы, цифры, дефис, подчеркивание
  const validPattern = /^[a-zA-Z0-9_-]+$/;
  return validPattern.test(skillId);
}

/**
 * Валидация содержимого файла скилла
 */
export function validateSkillContent(content: string): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Проверка наличия frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    errors.push('Missing or invalid frontmatter');
    return { valid: false, errors, warnings };
  }

  const frontmatter = frontmatterMatch[1];
  const metadata: Record<string, string> = {};

  // Парсинг frontmatter
  for (const line of frontmatter.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const colonIndex = trimmed.indexOf(':');
    if (colonIndex > 0) {
      const key = trimmed.slice(0, colonIndex).trim();
      const value = trimmed.slice(colonIndex + 1).trim();
      metadata[key] = value;
    }
  }

  // Проверка обязательных полей
  const requiredFields = ['name', 'description'];
  for (const field of requiredFields) {
    if (!metadata[field]) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Проверка длины контента
  const contentBody = content.slice(frontmatterMatch[0].length);
  if (contentBody.length > 50000) {
    warnings.push('Content exceeds recommended length (50000 characters)');
  }

  // Проверка на потенциально опасные конструкции
  const dangerousPatterns = [
    /require\(['"`](child_process|fs|os|path)['"`]\)/g,
    /eval\s*\(/g,
    /Function\s*\(/g,
    /exec\(/g,
    /spawn\(/g,
    /__proto__/g,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(contentBody)) {
      warnings.push('Potential security risk detected');
      break;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Валидация полного объекта скилла
 */
export function validateSkillObject(skill: any): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!skill) {
    errors.push('Skill object is required');
    return { valid: false, errors };
  }

  if (!skill.name || typeof skill.name !== 'string') {
    errors.push('Skill name is required and must be a string');
  }

  if (!skill.description || typeof skill.description !== 'string') {
    errors.push('Skill description is required and must be a string');
  }

  if (skill.category && typeof skill.category !== 'string') {
    errors.push('Skill category must be a string if provided');
  }

  if (!skill.content || typeof skill.content !== 'string') {
    errors.push('Skill content is required and must be a string');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}