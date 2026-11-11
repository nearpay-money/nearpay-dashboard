import "@nearpay-internal/ui/fonts.css";
import "@nearpay-internal/ui/tokens.css";
import "@nearpay-internal/ui/styles.css";
import "./styles.css";
import "./theme.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
