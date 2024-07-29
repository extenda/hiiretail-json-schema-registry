jest.mock('@actions/core');
const core = require('@actions/core');
const action = require('../src/index');

describe(`Sync schema action`, () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it('is calling action', async () => {
    core.getInput.mockReturnValueOnce('test/assets/che.not-existing.v1.json;test/assets/che.to-update.v1.json;test/assets/che.invalid-schema.v2.json')
      .mockReturnValueOnce('true');

    // const notExistingKind = 'che.not-existing.v1';
    // const notExistingKindFileName = `${notExistingKind}.json`;
    // const kind = 'che.to-update.v1';
    // const kindFileName = `${kind}.json`;
    // const kind2 = 'invaid-schema.v2';
    // const kind2FileName = `${kind2}.json`;

    await action();

    expect(core.startGroup).toHaveBeenCalledTimes(3);
    expect(core.endGroup).toHaveBeenCalledTimes(3);
    expect(core.info).toHaveBeenCalledTimes(4);
    expect(core.warning).toHaveBeenCalledTimes(1);
    expect(core.error).toHaveBeenCalledTimes(1);
  });
});
