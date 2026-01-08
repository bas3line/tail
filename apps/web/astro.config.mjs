import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import node from '@astrojs/node';

export default defineConfig({
  output: 'static',
  adapter: node({
    mode: 'standalone',
  }),
  integrations: [
    tailwind({
      applyBaseStyles: false,
    }),
  ],
  vite: {
    define: {
      'import.meta.env.PUBLIC_API_URL': JSON.stringify(process.env.API_URL || 'http://localhost:3000'),
      'import.meta.env.PUBLIC_SITE_URL': JSON.stringify(process.env.WEB_URL || 'http://localhost:4321'),
    },
  },
});

