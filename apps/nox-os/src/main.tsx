import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@nox-os/ui/styles.css";
import { App } from "./app";

const container = document.getElementById("root");

if (!container) {
  throw new Error("NØX-OS root element was not found.");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
