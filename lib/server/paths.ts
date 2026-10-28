import path from 'node:path'

const root = process.cwd()

export const DATA_DIR = path.join(root, 'data')
export const WORKSPACE_DIR = path.resolve(process.env.HEPHAESTUS_WORKSPACE || path.join(root, 'workspace'))
export const SKILLS_DIR = path.join(root, 'skills')
