const fs = require('fs');
const path = require('path');

console.log('=== Fixing build issues ===\n');

// 1. Fix actions/index.ts - add http-request import
let actionsIndex = fs.readFileSync('lib/actions/index.ts', 'utf8');
if (!actionsIndex.includes('http-request')) {
  actionsIndex = actionsIndex.replace(
    "import './scrape'",
    "import './scrape'\nimport './http-request'"
  );
  fs.writeFileSync('lib/actions/index.ts', actionsIndex);
  console.log('✓ Fixed lib/actions/index.ts - added http-request import');
} else {
  console.log('✓ lib/actions/index.ts already has http-request import');
}

// 2. Fix skills/index.ts - add tool-skill exports
let skillsIndex = fs.readFileSync('lib/skills/index.ts', 'utf8');
if (!skillsIndex.includes('tool-skill')) {
  skillsIndex = skillsIndex.replace(
    "export * from './tool';",
    "export * from './tool';\nexport * from './tool-skill';\nexport * from './tool-skills-examples';"
  );
  fs.writeFileSync('lib/skills/index.ts', skillsIndex);
  console.log('✓ Fixed lib/skills/index.ts - added tool-skill exports');
} else {
  console.log('✓ lib/skills/index.ts already has tool-skill exports');
}

// 3. Check if http-request.ts exists, if not create it
const httpRequestPath = 'lib/actions/http-request.ts';
if (!fs.existsSync(httpRequestPath)) {
  console.log('✗ http-request.ts missing - needs to be created');
} else {
  console.log('✓ lib/actions/http-request.ts exists');
}

// 4. Check if tool-skill.ts exists
const toolSkillPath = 'lib/skills/tool-skill.ts';
if (!fs.existsSync(toolSkillPath)) {
  console.log('✗ tool-skill.ts missing - needs to be created');
} else {
  // Fix duplicate export if present
  let toolSkillContent = fs.readFileSync(toolSkillPath, 'utf8');
  const duplicateExport = '// Export factory functions\nexport { toolSkillRegistry }';
  if (toolSkillContent.includes(duplicateExport)) {
    toolSkillContent = toolSkillContent.replace(duplicateExport, '');
    fs.writeFileSync(toolSkillPath, toolSkillContent);
    console.log('✓ Fixed lib/skills/tool-skill.ts - removed duplicate export');
  } else {
    console.log('✓ lib/skills/tool-skill.ts duplicate export check done');
  }
}

console.log('\n=== Fixes complete ===');
