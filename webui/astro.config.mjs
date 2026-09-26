// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  adapter: cloudflare({
    // This app does not use Astro's image optimization. The default
    // `cloudflare-binding` service would add an `IMAGES` binding that requires
    // the Cloudflare Images product; `passthrough` keeps the generated
    // wrangler config free of image bindings.
    imageService: 'passthrough',
  }),
  integrations: [react()],
  // This app does not use Astro sessions. The Cloudflare adapter otherwise
  // auto-enables a KV session driver and emits a `SESSION` KV binding without
  // a namespace_id into the generated wrangler config, which fails deploys
  // with error 10021. Disable sessions to keep the generated config clean.
  session: false,
});
