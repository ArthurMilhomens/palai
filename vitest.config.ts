import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';

function resolveJsToTs(): Plugin {
  return {
    name: 'resolve-js-to-ts',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer || !source.endsWith('.js') || source.startsWith('\0')) {
        return null;
      }
      const asTs = source.replace(/\.js$/, '.ts');
      const resolved = await this.resolve(asTs, importer, {
        ...options,
        skipSelf: true,
      });
      return resolved ?? null;
    },
  };
}

export default defineConfig({
  plugins: [resolveJsToTs()],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/__tests__/**/*.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: [
        'src/parser/game-dump.ts',
        'src/extractors/dump.ts',
        'src/shared/errors.ts',
        'src/shared/error-handler.ts',
        'src/shared/pagination.ts',
        'src/shared/i18n.ts',
        'src/shared/query.ts',
        'src/modules/breeding/formula.ts',
        'src/modules/auth/schemas.ts',
        'src/modules/auth/crypto.ts',
      ],
      exclude: ['src/**/*.test.ts', 'src/**/__tests__/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 65,
        statements: 80,
      },
    },
    setupFiles: ['src/test/setup.ts'],
  },
});
