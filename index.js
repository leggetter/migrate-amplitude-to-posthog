import fs from 'fs-extra'
import fetch from 'node-fetch'
import path from 'path'

import AdmZip from 'adm-zip'
import zlib from 'node:zlib'

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

  console.log('Download complete')

  const dirName = path.resolve('exports', new Date().toISOString())
  await fs.ensureDir(dirName)
  
  const filePath = path.resolve(dirName, 'export.zip')
  const arrayBuffer = await response.arrayBuffer()
  var buffer = Buffer.from( new Uint8Array(arrayBuffer) )
  await fs.promises.writeFile(filePath, buffer)

  console.log('File written to', filePath)
  return {dirName, filePath}
}

async function unzipExport({dirName, filePath}) {
  const zip = new AdmZip(filePath)
  var zipEntries = zip.getEntries()

  const jsonDirPath = path.resolve(dirName, 'json')

  await fs.ensureDir(jsonDirPath)

  await Promise.all(zipEntries.map(async (zipEntry) => {
    if (zipEntry.entryName.endsWith('.gz')) {
      const gzData = zlib.gunzipSync(zipEntry.getCompressedData())
      let perLineStringArray = Buffer.from(gzData).toString().split(/\r?\n/)
      perLineStringArray = perLineStringArray.filter(n => n) // remove empty lines/array elements
      const objectArray = perLineStringArray.map(value => {
        return JSON.parse(value)
      })
      await fs.writeJson(path.resolve(jsonDirPath, zipEntry.name.replace('.gz', '')), objectArray, {spaces: 2})
    }
  }))

  return jsonDirPath
}

async function sendToPostHog(jsonDirPath) {
  // {"$insert_id":"c969a556-e61b-4293-8a10-38ae67aa21fb","$insert_key":"019354d3c43a450d4a20bbdf9b2c1ca199#232","$schema":13,"adid":null,"amplitude_attribution_ids":null,"amplitude_event_type":null,"amplitude_id":538001826014,"app":409857,"city":null,"client_event_time":"2023-01-01 19:02:52.749000","client_upload_time":"2023-01-01 19:02:54.262000","country":null,"data":{"group_ids":{},"group_first_event":{}},"data_type":"event","device_brand":null,"device_carrier":null,"device_family":null,"device_id":"25241593-7196-5c00-b70c-170eb85bb4a6","device_manufacturer":null,"device_model":null,"device_type":null,"dma":null,"event_id":744142725,"event_properties":{"referer":"http://52.2.56.64:80/","ip":"198.235.24.45","originalURL":"https://www.tigrisdata.com/jamstack"},"event_time":"2023-01-01 19:02:52.749000","event_type":"view_page","global_user_properties":{},"group_properties":{},"groups":{},"idfa":null,"ip_address":null,"is_attribution_event":false,"language":null,"library":"segment","location_lat":null,"location_lng":null,"os_name":null,"os_version":null,"partner_id":null,"paying":null,"plan":{},"platform":null,"processed_time":"2023-01-01 19:02:56.944373","region":null,"sample_rate":null,"server_received_time":"2023-01-01 19:02:54.262000","server_upload_time":"2023-01-01 19:02:54.266000","session_id":-1,"source_id":null,"start_version":null,"user_creation_time":"2023-01-01 19:02:52.749000","user_id":"06cdb68f-885b-4b6e-be54-69b38b5b0d95","user_properties":{},"uuid":"e6fe6a70-8a06-11ed-9ac0-ab8bd3fc3d15","version_name":null}

  const files = await fs.promises.readdir(jsonDirPath)
  console.log(files)

  for (const jsonFileName of files) {
    const nextFileName = path.resolve(jsonDirPath, jsonFileName)
    console.log('Reading', nextFileName)
    const json = await fs.readJson(nextFileName)
    console.log(json)

    // TODO: convert to PostHog format
    // const distinctId = user_id || device_id;
    // const eventMessage = {
    //   properties: {
    //     ...event_properties,
    //     ...other_fields,
    //     $set: { ...user_properties, ...group_properties },
    //     $geoip_disable: true,
    //   },
    //   event: event_name, // TODO: map 'view_page', 'Viewed', 'Viewed docs' to $pageview
    //   distinctId: distinctId,
    //   timestamp: event_time,
    // }
    // TODO: create batch per file https://posthog.com/docs/api/post-only-endpoints#batch-events
    // TODO: record which JSON file has been successfully processes in case of failure and the need to resume
    // TODO: create test PostHog project
    // TODO: send as batch
  }
}

(async () => {
  const exportResult = await exportFromAmplitude();
  const jsonDirPath = await unzipExport(exportResult)
  sendToPostHog(jsonDirPath)
})()

// (async () => {
//   const fakeResult = {dirName: 'test-export', filePath: 'test-export/export.zip' }
//   const jsonDirPath = await unzipExport(fakeResult)
// })()

// (async () => {
//   const jsonDirPath = 'test-export/json'
//   sendToPostHog(jsonDirPath)
// })()
