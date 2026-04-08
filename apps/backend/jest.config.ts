export default {
  displayName: 'backend',
  preset: '../../jest.preset.js',
  globals: {},
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json'
      }
    ]
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  transformIgnorePatterns: ['node_modules/(?!mathml2omml|@types/passport|@nestjs/passport)'],
  coverageDirectory: '../../coverage/apps/backend'
};
