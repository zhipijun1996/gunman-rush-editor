import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
export default defineConfig({root:fileURLToPath(new URL('.',import.meta.url)),base:'./',plugins:[react()],build:{outDir:'../../dist/editor',emptyOutDir:true},server:{fs:{allow:[fileURLToPath(new URL('../..',import.meta.url))]}}});
