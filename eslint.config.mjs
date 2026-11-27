import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // eslint-plugin-react's "detect" setting calls context.getFilename(), which ESLint 10 removed.
  // Naming the installed React major avoids that call; keep it in step with package.json.
  { settings: { react: { version: '19.3' } } },
  globalIgnores(['.next/**', 'dist/**', 'out/**', 'build/**', 'portable-launcher/wwwroot/**', 'AUDIT-Portable/**', 'InformationSystemUserTracker-Portable/**', 'next-env.d.ts']),
]);

export default eslintConfig;
