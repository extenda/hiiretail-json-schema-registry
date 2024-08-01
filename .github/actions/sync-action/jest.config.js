module.exports = {
  automock: false,
  reporters: [
    'default',
  ],
  rootDir: process.cwd(),
  testEnvironment: 'node',
  maxWorkers: '50%',
  // setupFiles: ['./jest.setup.js'],
};
