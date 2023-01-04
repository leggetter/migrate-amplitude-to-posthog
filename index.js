import fs from 'fs-extra'
import fetch from 'node-fetch'
import path from 'path'

import * as dotenv from 'dotenv'
dotenv.config()

if(!process.env.AMPLITUDE_API_KEY) {
  throw new Error('The AMPLITUDE_API_KEY environmental variable is required')
}

if(!process.env.AMPLITUDE_API_SECRET) {
  throw new Error('The AMPLITUDE_API_SECRET environmental variable is required')
}

if(!process.env.START_EXPORT_DATE) {
  throw new Error('The START_EXPORT_DATE environmental variable is required and should be in the format MM/DD/YYYY')
}

if(!process.env.END_EXPORT_DATE) {
  throw new Error('The END_EXPORT_DATE environmental variable is required and should be in the format MM/DD/YYYY')
}

function stringToAmplitudeDateFormat(dateString, hour) {
  return new Date(dateString).toISOString().replace(/(T\d{2}).*/, `T${hour}`).replace(/-/g, '')
}

async function exportFromAmplitude() {
  // GET /api/2/export?start=20220101T00&end=20220127T00

  const auth = Buffer.from(`${process.env.AMPLITUDE_API_KEY}:${process.env.AMPLITUDE_API_SECRET}`).toString('base64')

  console.log('Making request... this can take some time')
  
  const url = `https://amplitude.com/api/2/export?` +
              `start=${stringToAmplitudeDateFormat(process.env.START_EXPORT_DATE, '00')}` +
              `&end=${stringToAmplitudeDateFormat(process.env.END_EXPORT_DATE, '23')}`
  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`
    },
  })

  console.log()
  console.log('Download complete')

  const dirName = new Date().toISOString()
  await fs.mkdir(dirName)
  
  const filePath = path.resolve(dirName, 'export.zip')
  const arrayBuffer = await response.arrayBuffer()
  var buffer = Buffer.from( new Uint8Array(arrayBuffer) )
  console.log(typeof buffer)
  await fs.promises.writeFile(filePath, buffer)

  console.log('File written to', filePath)
  return {dirName, filePath}
}

async function unzipExport({dirName, filePath}) {
  // TODO: unzip filePath

  const files = await fs.promises.readdir(dirName)
  console.log(files)
}

(async () => {
  const exportResult = await exportFromAmplitude();
  await unzipExport(exportResult)
})();