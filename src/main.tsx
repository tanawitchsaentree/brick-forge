import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { loadCatalog } from "./engine/catalog";
import { loadThumbIndex } from "./scene/thumbnails";
import "./styles.css";

// The catalog must be in place before the saved model is restored.
Promise.all([loadCatalog(), loadThumbIndex()]).then(([ldraw]) => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App ldraw={ldraw} />
    </StrictMode>,
  );
});
