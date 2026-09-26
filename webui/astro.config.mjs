// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  // Disable Astro sessions: this app is fully client-side and does not use
  // server-side sessions. The Cloudflare adapter otherwise auto-enables a KV
  // binding named `SESSION`, which requires a namespace_id at deploy time.
  session: false,
  adapter: cloudflare({
    // Skip the Cloudflare Images binding requirements for build/preview.
    imageService: 'passthrough',
  }),
});
