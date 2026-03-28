import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['**/tests/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          moduleResolution: 'node',
          rootDir: '.',
        },
      },
    ],
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/cli/**',
    '!src/index.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFiles: ['reflect-metadata'],
};

export default config;
