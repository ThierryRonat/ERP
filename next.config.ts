import type { NextConfig } from "next";

// cacheComponents est volontairement DÉSACTIVÉ : dans un ERP, chaque page dépend
// de l'utilisateur connecté, donc tout est rendu à la demande (plus simple et plus sûr).
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
