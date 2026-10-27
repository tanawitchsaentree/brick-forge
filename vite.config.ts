import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Loaded on demand (model import); pre-bundle them so the first import doesn't stall.
    include: [
      "three/examples/jsm/loaders/GLTFLoader.js",
      "three/examples/jsm/loaders/STLLoader.js",
      "three/examples/jsm/loaders/OBJLoader.js",
      "three/examples/jsm/exporters/STLExporter.js",
    ],
  },
});
