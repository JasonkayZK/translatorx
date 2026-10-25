import { restoreTheme } from "../lib/theme";
import { setLocale } from "../lib/i18n";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MiniApp } from "./MiniApp";
import "../styles.css";
import "./mini.css";

setLocale("system");
restoreTheme("mini");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MiniApp />
  </StrictMode>,
);
