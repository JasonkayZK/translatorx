import { restoreTheme } from "./lib/theme";
import { setLocale } from "./lib/i18n";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

setLocale("system");
restoreTheme("main");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
