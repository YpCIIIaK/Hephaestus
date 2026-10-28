import path from 'node:path'

// Пути вычисляются во время выполнения: пометка turbopackIgnore не даёт
// сборщику трассировать весь проект ради динамического доступа к файлам.
const root = /* turbopackIgnore: true */ process.cwd()

export const DATA_DIR = path.join(/* turbopackIgnore: true */ root, 'data')
export const WORKSPACE_DIR = path.resolve(/* turbopackIgnore: true */ process.env.HEPHAESTUS_WORKSPACE || path.join(root, 'workspace'))
export const SKILLS_DIR = path.join(/* turbopackIgnore: true */ root, 'skills')
