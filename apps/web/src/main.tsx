import { createRoot } from "react-dom/client";
import App from "./App";
// Bundled fonts: nothing in the UI depends on a third-party font host.
// Latin subsets only: one small @font-face per weight instead of five unicode-range blocks. Rare glyphs (arrows, ≈) fall back to a system font.
import "@fontsource/geist/latin-400.css";
import "@fontsource/geist/latin-500.css";
import "@fontsource/geist/latin-600.css";
import "@fontsource/geist-mono/latin-400.css";
import "@fontsource/geist-mono/latin-500.css";
import "@fontsource/instrument-serif/latin-400.css";
import "@fontsource/instrument-serif/latin-400-italic.css";
import "./theme"; // applies the saved/system theme before the first render
import { installHoverFx } from "./hoverfx";
import { installStackTables } from "./stacktables";
import "./styles.css";
createRoot(document.getElementById("root")!).render(<App />);
installHoverFx();
installStackTables();
