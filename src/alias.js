import Conf from 'conf'

const alias = new Conf({
  configName: 'alias',
  fileExtension: 'conf',
  // docs warn against changing `cwd`, but we want to store the config in the app directory
  cwd: process.cwd(),
})

export default alias
