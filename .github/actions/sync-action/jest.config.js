module.exports = {
  automock: false,
  collectCoverage: true,
  reporters: [
    'default',
  ],
  rootDir: process.cwd(),
  testEnvironment: 'node',
  maxWorkers: '50%',
  // setupFiles: ['./jest.setup.js'],
};
