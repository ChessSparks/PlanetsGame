import { defineConfig } from 'vite';

// Relative base ('./' instead of the default '/') so the built asset/chunk
// URLs work regardless of what subpath the page is served from — itch.io
// serves HTML games from their own namespaced path, not the domain root,
// so an absolute base would 404 every asset the moment it's uploaded there.
export default defineConfig({
  base: './',
});
