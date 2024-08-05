const core = require('@actions/core');
const fs = require('fs');
const axios = require('axios');
const fetchToken = require('./utils/fetch-token');

const run = async (act) => {
  try {
    await act();
  } catch (err) {
    core.setFailed(err.message);
  }
};

function printReport(report) {
  for (const {
    kind, messages, warnings, errors,
  } of report.reports) {
    core.startGroup(`${kind}`);

    if (messages) {
      for (const message of messages) {
        core.info(`[${kind}]: ${message}`);
      }
    }
    if (warnings) {
      for (const warning of warnings) {
        core.warning(`[${kind}]: ${warning}`);
      }
    }
    if (errors) {
      for (const error of errors) {
        core.error(`[${kind}]: ${error}`);
      }
    }

    core.endGroup();
  }
}

async function action() {
  const dryRun = core.getBooleanInput('dry-run') === true;
  const inputFiles = core.getInput('schema-files').split(';');
  const token = await fetchToken({
    key: process.env.AUTH_KEY,
    email: process.env.AUTH_EMAIL,
    pass: process.env.AUTH_PASS,
    gipTenantId: 'extenda-mdcg6',
  });

  const payload = {
    schemas: inputFiles.map((file) => ({
      kind: file.substring(file.lastIndexOf('/') + 1, file.lastIndexOf('.')),
      fileName: file,
      schemaValue: JSON.parse(fs.readFileSync(file, 'utf8')),
    })),
  };

  const { data } = await axios.post(
    `https://ccc-api.retailsvc.com/api/v1/internal/schemas:sync?dryRun=${dryRun}`,
    payload,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );

  printReport(data);

  if (!data.success) {
    core.setFailed('Sync process had some errors (see details above).');
  }

  core.info('Sync process completed successfully.');
}

if (require.main === module) {
  run(action);
}

module.exports = action;
