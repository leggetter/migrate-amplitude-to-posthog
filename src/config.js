import Conf from 'conf'

const config = new Conf({
  configName: 'migration',
  fileExtension: 'conf',
  // docs warn against changing `cwd`, but we want to store the config in the app directory
  cwd: process.cwd(),
  migration_step: {
    type: 'number'
  },
  migration_directory: {
    type: 'string',
  },
  last_json_imported: {
    type: 'string'
  },
})

import * as dotenv from 'dotenv'
dotenv.config()

export default config