const core = require('@actions/core');
const fs = require('fs');
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

  const payload = inputFiles.map(file => {
    return {
      kind: file.substring(file.lastIndexOf('/') + 1, file.lastIndexOf('.')),
      schemaFile: file,
      schemaValue: JSON.parse(fs.readFileSync(file, 'utf8')),
    }
  });

  //TODO: get results for all schema files
  // // eslint-disable-next-line no-await-in-loop
  // const { data } = await cccApi.post(
  //   `/api/v1/internal/schema:sync?dryRun=${dryRun}`,
  //   payload,
  // );

  const notExistingKind = 'che.not-existing.v1';
  const notExistingKindFileName = `${notExistingKind}.json`;
  const kind = 'che.workspace.v1';
  const kindFileName = `${kind}.json`;
  const kind2 = 'che.workspace.v2';
  const kind2FileName = `${kind2}.json`;
  const report = {
    reports: [
      {
        kind: notExistingKind,
        messages: ['Skipped'],
        warnings: [
          `Schema ${notExistingKindFileName} is not attached to any kind, skipping backwards compatibility check`,
        ],
      },
      {
        kind: kind,
        messages: [
          `Schema ${kindFileName} for kind ${kind} is backwards compatible`,
        ],
      },
      {
        kind: kind2,
        messages: [
          `Schema ${kind2FileName} for kind ${kind2} is not backwards compatible`,
        ],
        errors: [
          '{"error":"Undefined must have required property \\"newProp\\"","path":""}',
        ],
      },
    ],
    success: false,
  };

  printReport(report);

  if (!report.success) {
    core.setFailed('Sync process had some errors (see details above).');
  }

  core.info('Sync process completed successfully.');
}

if (require.main === module) {
  run(action);
}

module.exports = action;
