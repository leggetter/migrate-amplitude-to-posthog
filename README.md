# Migrates Amplitude data to PostHog

A small utility that migrates data from an [Amplitude](https://amplitude.com) project to a [PostHog](https://posthog.com) project.

## How it works

1. Exports project data from Amplitude via the [Amplitude Export API](https://www.docs.developers.amplitude.com/analytics/apis/export-api/)
2. Converts the exported data into JSON files and stores them locally
3. Iterates through the stored JSON files, creates PostHog events from the data, and sends those events to PostHog

**See [the TODO section](#todo) for status.**

## Setup

1. Clone the GitHub project:

   ```shell
   git clone git@github.com:leggetter/migrate-amplitude-to-posthog.git && cd migrate-amplitude-to-posthog
   ```

2. Install the project dependencies:

   ```shell
   npm install
   ```

3. Configure the utility via the guided prompts by running the following command:

   ```shell
   node src/index.js config
   ```

   See the [Amplitude docs on getting your API credentials](https://www.docs.developers.amplitude.com/analytics/find-api-credentials/) for the `AMPLITUDE_API_KEY` and `AMPLITUDE_API_SECRET`. 
   
   The Amplitude export start and end dates should be in the format `MM/DD/YYYY`.

   You can find your PostHog project API key within your **Project settings**.

   Configuration is stored in `migration.conf`.

## Usage

Once the utility has been setup with the required configuration you can run additional commands:

```shell
Usage: index [options] [command]

Options:
  -h, --help                                 display help for command

Commands:
  config                                     Checks for any missing required configuration. Prompts when
                                             required configuration is missing. Configuration is stored in
                                             migration.conf in the working directory.
  full-migration                             Performs a full Amplitude export, file unzipping and JSON
                                             file setup, and PostHog event import.
  unzip-only <export-zip-path>               Unzipped the Amplitude export zip file and sets up the JSON
                                             files ready for the PostHog import. Request an export zip file.
  posthog-import-only <json-directory-path>  Imports the JSON files from the Amplitude export into
                                             PostHog. Requires the JSON files.
  help [command]                             display help for command
```

## TODO

### Planned

- [x] Extract the data from Amplitude
- [x] Unzip and convert the data into JSON files and store
- [x] Iterate over the stored JSON files, convert the Amplitude events to PostHog events and send them to PostHog
- [ ] Add alias tracking

## Nice to have

- [ ] Store PostHog event capture progress as iterating so that the process can be resumed if a request fails
- [ ] Add some tests around key areas. Everything has been tested manually up until this point.
- [ ] Make PostHog import batch size configurable (it is presently hard-coded as 1000) and fully adhere to the specified batch size

## Acknowledgements

- [Tigris Data: Developer Data Platform](https://tigrisdata.com): this utility was built whilst working for them
- [Aplistorical](https://github.com/vicampuzano/aplistorical): a PHP-based Amplitude to PostHog migration tool the was a useful reference during development