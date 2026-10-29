import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { loadCatalog } from "./engine/catalog";
import { loadThumbIndex } from "./scene/thumbnails";
import "./ui/inputMode";
import { Environment } from "pane-react";
// Pane first, the app's own styles after (they win while screens move over: docs/pane-migration.md).
import "pane-react/all.css";
import "./styles.css";

// The catalog must be in place before the saved model is restored.
Promise.all([loadCatalog(), loadThumbIndex()]).then(([ldraw]) => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      {/* The 3D table is a bright backdrop; Pane's panes are glass over it. */}
      <Environment brightness="bright" style={{ display: "contents" }}>
        <App ldraw={ldraw} />
      </Environment>
    </StrictMode>,
  );
});
