jest.mock('@actions/core');
const core = require('@actions/core');
const action = require('../src/index');
const axios = require('axios');
const nock = require('nock');
const fs = require('fs');

const secrets = {
  key: 'iam-api-key-prod',
  email: 'ccc-api-email',
  pass: 'ccc-api-pass',
};

process.env.AUTH_KEY = secrets.key;
process.env.AUTH_EMAIL = secrets.email;
process.env.AUTH_PASS = secrets.pass;

const notExistingKind = 'che.not-existing.v1';
const notExistingKindFileName = `test/assets/${notExistingKind}.json`;
const toUpdateKind = 'che.to-update.v1';
const toUpdateKindFileName = `test/assets/${toUpdateKind}.json`;
const invalidSchemaKind = 'che.invalid-schema.v2';
const invalidSchemaKindFileName = `test/assets/${invalidSchemaKind}.json`;

describe(`Sync schema action`, () => {
  beforeAll(() => {
    nock.disableNetConnect();
    nock.enableNetConnect(
      /(https:\/\/ccc-api.retailsvc.com|https:\/\/identitytoolkit.googleapis.com)/,
    );
  });

  afterAll(() => {
    nock.enableNetConnect();
  });

  beforeEach(() => {
    nock.cleanAll();
    mockIdpTokenCall();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it.each([true, false])('calls ccc api with various schemas dryRun=%s', async (dryRun) => {
    core.getInput.mockReturnValueOnce('test/assets/che.not-existing.v1.json;test/assets/che.to-update.v1.json;test/assets/che.invalid-schema.v2.json');
    core.getBooleanInput.mockReturnValue(dryRun);

    const notExistingSchemaValue = JSON.parse(fs.readFileSync(notExistingKindFileName, 'utf8'));
    const toUpdateSchemaValue = JSON.parse(fs.readFileSync(toUpdateKindFileName, 'utf8'));
    const invalidSchemaValue = JSON.parse(fs.readFileSync(invalidSchemaKindFileName, 'utf8'));

    const payload = {
      schemas: [
        {
          kind: notExistingKind,
          fileName: notExistingKindFileName,
          schemaValue: notExistingSchemaValue,
        },
        {
          kind: toUpdateKind,
          fileName: toUpdateKindFileName,
          schemaValue: toUpdateSchemaValue,
        },
        {
          kind: invalidSchemaKind,
          fileName: invalidSchemaKindFileName,
          schemaValue: invalidSchemaValue,
        },
      ]
    };

    const response = {
      reports: [
        {
          kind: notExistingKind,
          messages: ['Skipped'],
          warnings: [
            `Schema ${notExistingKindFileName} is not attached to any kind, skipping backwards compatibility check`,
          ],
        },
        {
          kind: toUpdateKind,
          messages: [
            `Schema ${toUpdateKindFileName} for kind ${toUpdateKind} is backwards compatible`,
          ],
        },
        {
          kind: invalidSchemaKind,
          messages: [
            `Schema ${invalidSchemaKindFileName} for kind ${invalidSchemaKind} is not backwards compatible`,
          ],
          errors: [
            '{"error":"Undefined must have required property \\"newProp\\"","path":""}',
          ],
        },
      ],
      success: false,
    };

    const expectCccToBeCalled = mockCccSyncCall(payload, response, dryRun);

    expect(await action()).toBeUndefined();

    expectCccToBeCalled();

    expect(core.startGroup).toHaveBeenCalledTimes(3);
    expect(core.endGroup).toHaveBeenCalledTimes(3);
    expect(core.info).toHaveBeenCalledTimes(4);
    expect(core.warning).toHaveBeenCalledTimes(1);
    expect(core.error).toHaveBeenCalledTimes(1);
  });
});

function mockIdpTokenCall() {
  nock('https://identitytoolkit.googleapis.com')
    .post(`/v1/accounts:signInWithPassword?key=${secrets.key}`, {
      email: secrets.email,
      password: secrets.pass,
      tenantId: 'extenda-mdcg6',
      returnSecureToken: true,
    })
    .reply(200, { idToken: 'mockIdToken' })
    .persist();
}

function mockCccSyncCall(payload, response, dryRun = false) {
  const cccNock = nock('https://ccc-api.retailsvc.com')
    .post('/api/v1/internal/schemas:sync', payload)
    .query({ dryRun })
    .reply(200, response);
  return () => expect(cccNock.isDone()).toEqual(true);
}

