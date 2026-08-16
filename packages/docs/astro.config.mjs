// @ts-check
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

// Static output (default). No adapter: the site is deployed as static files.
export default defineConfig({
  site: "https://schemat.ahamid.me",
  integrations: [
    starlight({
      title: "Schemat",
      description:
        "Git-native database schema documentation. Live, interactive ER diagrams from your repo.",
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/alirezahamid/schemat",
        },
      ],
      components: {
        // Two-state button instead of the stock auto/light/dark <select>.
        ThemeSelect: "./src/components/ThemeToggle.astro",
      },
      customCss: [
        "@fontsource/ibm-plex-mono/latin-400.css",
        "@fontsource/ibm-plex-mono/latin-500.css",
        "@fontsource/ibm-plex-mono/latin-600.css",
        "@fontsource/ibm-plex-mono/latin-ext-400.css",
        "@fontsource/ibm-plex-mono/latin-ext-500.css",
        "@fontsource/ibm-plex-mono/latin-ext-600.css",
        "./src/styles/tokens.css",
        "./src/styles/docs.css",
      ],
      sidebar: [
        {
          label: "Start",
          items: [
            { label: "Install", slug: "start/install" },
            { label: "Quick start", slug: "start/quick-start" },
            { label: "Source detection", slug: "start/sources" },
          ],
        },
        {
          label: "CI",
          items: [{ label: "GitHub Action", slug: "ci/github-action" }],
        },
        {
          label: "Guides",
          items: [
            { label: "Writing a parser", slug: "guides/writing-a-parser" },
            { label: "Canvas performance", slug: "guides/canvas-performance" },
          ],
        },
        {
          label: "Reference",
          items: [{ label: "IR v2 migration", slug: "reference/ir-v2-migration" }],
        },
      ],
    }),
  ],
});
