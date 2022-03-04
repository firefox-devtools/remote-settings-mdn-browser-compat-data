/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at <http://mozilla.org/MPL/2.0/>. */

/* global process */

// This script consumes env variables:
// - AUTHORIZATION (mandatory): Raw authorization header (e.g. `AUTHORIZATION='Bearer XXXXXXXXXXXXX'`)
// - SERVER (mandatory): Writer server URL (eg. https://settings-writer.stage.mozaws.net/v1)
// - ENVIRONMENT (optional): dev, stage, prod. When set to `dev`, the data will be automatically published.
// - DRY_RUN (optional): If set to 1, no changes will be made to the collection, this will
//                       only log the actions that would be done.

// The Compatibility panel detects issues by comparing against official MDN compatibility data
// at https://github.com/mdn/browser-compat-data.

// The subsets from the dataset required by the Compatibility panel are:
// * browsers: https://github.com/mdn/browser-compat-data/tree/main/browsers
// * css.properties: https://github.com/mdn/browser-compat-data/tree/main/css

// The MDN compatibility data is available as a node package ("@mdn/browser-compat-data").
// This node script fetches `browsers.json` and `css-properties.json` and updates records
// from the appropriate collection in RemoteSettings.

import fetch from "node-fetch";
import compatData from "@mdn/browser-compat-data";

const SUCCESS_RET_VALUE = 0;
const FAILURE_RET_VALUE = 1;
const VALID_ENVIRONMENTS = ["dev", "stage", "prod"];

if (!process.env.AUTHORIZATION) {
  console.error(`AUTHORIZATION environment variable needs to be set`);
  process.exit(FAILURE_RET_VALUE);
}

if (!process.env.SERVER) {
  console.error(`SERVER environment variable needs to be set`);
  process.exit(FAILURE_RET_VALUE);
}

if (
  process.env.ENVIRONMENT &&
  !VALID_ENVIRONMENTS.includes(process.env.ENVIRONMENT)
) {
  console.error(
    `ENVIRONMENT environment variable needs to be set to one of the following values: ${VALID_ENVIRONMENTS.join(
      ", "
    )}`
  );
  process.exit(FAILURE_RET_VALUE);
}

const rsBrowsersCollectionEndpoint = `${process.env.SERVER}/buckets/main-workspace/collections/devtools-compatibility-browsers`;
const rsBrowsersRecordsEndpoint = `${rsBrowsersCollectionEndpoint}/records`;
const isDryRun = process.env.DRY_RUN == "1";

update()
  .then(() => {
    return process.exit(SUCCESS_RET_VALUE);
  })
  .catch((e) => {
    console.error(e);
    return process.exit(FAILURE_RET_VALUE);
  });

async function update() {
  console.log(`Get existing records from ${rsBrowsersCollectionEndpoint}`);
  const records = await getRSRecords();
  const operations = { added: [], updated: [], removed: [] };

  const browsersMdn = getFlatBrowsersMdnData();

  for (const browserMdn of browsersMdn) {
    const rsRecord = records.find(
      (record) =>
        record.browserid == browserMdn.browserid &&
        record.version == browserMdn.version
    );
    if (browserMdn.status == "retired") {
      if (rsRecord) {
        const succesful = await deleteRecord(rsRecord);
        if (succesful) {
          operations.removed.push(rsRecord);
        }
      }
      continue;
    }

    if (!rsRecord) {
      const succesful = await createRecord(browserMdn);
      if (succesful) {
        operations.added.push(browserMdn);
      }
      continue;
    }

    if (
      rsRecord.status !== browserMdn.status ||
      rsRecord.name !== browserMdn.name
    ) {
      const succesful = await updateRecord(rsRecord, browserMdn);
      if (succesful) {
        operations.updated.push(browserMdn);
      }
    }
  }

  for (const record of records) {
    const browserMdn = browsersMdn.find(
      (browser) =>
        browser.browserid == record.browserid &&
        browser.version == record.version
    );
    if (!browserMdn) {
      const succesful = await deleteRecord(record);
      if (succesful) {
        operations.removed.push(record);
      }
    }
  }

  console.group("Results");
  console.log("Added:", operations.added.length);
  if (operations.added.length > 0) {
    console.table(operations.added);
  }
  console.log("Updated:", operations.updated.length);
  if (operations.updated.length > 0) {
    console.table(operations.updated);
  }
  console.log("Removed:", operations.removed.length);
  if (operations.removed.length > 0) {
    console.table(operations.removed);
  }
  console.groupEnd();

  if (
    operations.added.length +
      operations.updated.length +
      operations.removed.length ==
    0
  ) {
    console.log("No changes detected");
  } else {
    const refreshedRecords = await getRSRecords();
    console.log("Browsers data synced ✅\nRefreshed records:");
    console.table(refreshedRecords);
    if (process.env.ENVIRONMENT === "dev") {
      console.log("Approving changes");
      await approveChanges();
      console.log("Changes approved ✅");
    } else {
      console.log("Requesting review");
      await requestReview();
      console.log("Review requested ✅");
    }
  }
}

async function getRSRecords() {
  const response = await fetch(rsBrowsersRecordsEndpoint, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: process.env.AUTHORIZATION,
    },
  });
  if (response.status !== 200) {
    throw new Error(
      `Can't retrieve records: "[${response.status}] ${response.statusText}"`
    );
  }
  const { data } = await response.json();
  return data;
}

/**
 * Create a record on RemoteSetting
 *
 * @param {Object} browserMdn: An item from the result of getFlatBrowsersMdnData
 * @returns {Boolean} Whether the API call was succesful or not
 */
async function createRecord(browserMdn) {
  console.log("Create", browserMdn.browserid, browserMdn.version);
  if (isDryRun) {
    return true;
  }

  const response = await fetch(`${rsBrowsersRecordsEndpoint}`, {
    method: "POST",
    body: JSON.stringify({ data: browserMdn }),
    headers: {
      "Content-Type": "application/json",
      Authorization: process.env.AUTHORIZATION,
    },
  });
  const succesful = response.status == 201;
  if (!succesful) {
    console.warn(
      `Couldn't create record: "[${response.status}] ${response.statusText}"`
    );
  }
  return succesful;
}

/**
 * Update a record on RemoteSetting
 *
 * @param {Object} record: The existing record on RemoteSetting
 * @param {Object} browserMdn: An item from the result of getFlatBrowsersMdnData whose data
 *                             will be put into the record.
 * @returns {Boolean} Whether the API call was succesful or not
 */
async function updateRecord(record, browserMdn) {
  console.log("Update", record.browserid, record.version);
  if (isDryRun) {
    return true;
  }

  const response = await fetch(`${rsBrowsersRecordsEndpoint}/${record.id}`, {
    method: "PUT",
    body: JSON.stringify({ data: browserMdn }),
    headers: {
      "Content-Type": "application/json",
      Authorization: process.env.AUTHORIZATION,
    },
  });
  const succesful = response.status == 200;
  if (!succesful) {
    console.warn(
      `Couldn't update record: "[${response.status}] ${response.statusText}"`
    );
  }
  return succesful;
}

/**
 * Remove a record on RemoteSetting
 *
 * @param {Object} record: The existing record on RemoteSetting
 * @returns {Boolean} Whether the API call was succesful or not
 */
async function deleteRecord(record) {
  console.log("Delete", record.browserid, record.version);
  if (isDryRun) {
    return true;
  }

  const response = await fetch(`${rsBrowsersRecordsEndpoint}/${record.id}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Authorization: process.env.AUTHORIZATION,
    },
  });
  const succesful = response.status == 200;
  if (!succesful) {
    console.warn(
      `Couldn't delete record: "[${response.status}] ${response.statusText}"`
    );
  }
  return succesful;
}

/**
 * Ask for review on the collection.
 */
async function requestReview() {
  if (isDryRun) {
    return true;
  }

  const response = await fetch(rsBrowsersCollectionEndpoint, {
    method: "PATCH",
    body: JSON.stringify({ data: { status: "to-review" } }),
    headers: {
      "Content-Type": "application/json",
      Authorization: process.env.AUTHORIZATION,
    },
  });
  if (response.status !== 200) {
    console.warn(
      `Couldn't request review: "[${response.status}] ${response.statusText}"`
    );
  }
}

/**
 * Automatically approve changes made on the collection.
 * ⚠️ This only works on the `dev` server.
 */
async function approveChanges() {
  if (isDryRun) {
    return true;
  }

  const response = await fetch(rsBrowsersCollectionEndpoint, {
    method: "PATCH",
    body: JSON.stringify({ data: { status: "to-sign" } }),
    headers: {
      "Content-Type": "application/json",
      Authorization: process.env.AUTHORIZATION,
    },
  });
  if (response.status !== 200) {
    console.warn(
      `Couldn't automatically approve changes: "[${response.status}] ${response.statusText}"`
    );
  }
}

function getFlatBrowsersMdnData() {
  const browsers = [];
  for (const [browserid, browserInfo] of Object.entries(compatData.browsers)) {
    for (const [releaseNumber, releaseInfo] of Object.entries(
      browserInfo.releases
    )) {
      if (!browserInfo.name) {
        console.error(
          `${browserid} "name" property is expected but wasn't found`,
          browserInfo
        );
        continue;
      }

      if (!releaseInfo.status) {
        console.error(
          `${browserid} "status" property is expected but wasn't found`,
          releaseInfo
        );
        continue;
      }

      if (!releaseNumber || !releaseNumber.match(/\d/)) {
        console.error(
          `${browserid} "releaseNumber" doesn't have expected shape`,
          releaseNumber
        );
        continue;
      }

      browsers.push({
        browserid,
        name: browserInfo.name,
        status: releaseInfo.status,
        version: releaseNumber,
      });
    }
  }
  return browsers;
}
