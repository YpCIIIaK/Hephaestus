import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Тесты не должны читать и менять настройки пользователя в data/:
// там может быть указана настоящая рабочая папка проекта.
process.env.HEPHAESTUS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'heph-data-'))
