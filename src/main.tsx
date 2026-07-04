import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Bundled fonts (local files, zero network at runtime).
import "@fontsource/courier-prime/400.css";
import "@fontsource/courier-prime/700.css";
import "@fontsource/courier-prime/400-italic.css";
import "@fontsource/big-shoulders-display/600.css";
import "@fontsource/big-shoulders-display/700.css";
import "@fontsource-variable/inter";
import "@fontsource/opendyslexic/400.css";
import "@fontsource/opendyslexic/700.css";

import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
