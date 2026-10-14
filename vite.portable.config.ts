import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';

export default defineConfig({
  root: resolve(import.meta.dirname,'portable'),
  plugins:[react()],
  build:{outDir:resolve(import.meta.dirname,'portable-launcher','wwwroot'),emptyOutDir:true,sourcemap:false,target:'es2020',chunkSizeWarningLimit:1800},
});
