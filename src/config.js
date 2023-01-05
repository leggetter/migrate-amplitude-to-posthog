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
  AMPLITUDE_API_KEY: {
    type: 'string',
  },
  AMPLITUDE_API_SECRET: {
    type: 'string'
  },
  AMPLITUDE_START_EXPORT_DATE: {
    type: 'string',
    pattern: '^(\d{2}\/\d{2}\/\d{4})$'
  },
  AMPLITUDE_END_EXPORT_DATE: {
    type: 'string',
    pattern: '^(\d{2}\/\d{2}\/\d{4})$'
  },
  POSTHOG_API_HOST: {
    type: 'string'
  }
})

export default config