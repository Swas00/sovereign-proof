import { createRoot } from "react-dom/client";
import App from "./App";
// Bundled fonts: nothing in the UI depends on a third-party font host.
import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
import "@fontsource/geist/600.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "./theme"; // applies the saved/system theme before the first render
import "./styles.css";
createRoot(document.getElementById("root")!).render(<App />);
