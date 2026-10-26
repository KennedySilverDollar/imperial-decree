import "@fontsource/noto-serif-jp/300.css";
import "@fontsource/noto-serif-jp/400.css";
import "@fontsource/noto-serif-jp/700.css";
import "@fontsource/noto-sans-jp/400.css";
import "@fontsource/noto-sans-jp/700.css";
import "./ui/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PAPER_FADE_MS, STAMP_ANIMATION_MS } from "./domain/constants";
import { messages } from "./i18n/messages";
import { DebugPanel } from "./ui/panels/DebugPanel";
import { llmMode } from "./ui/runtime";
import { App } from "./ui/App";

document.title = messages.ui.title;

// 演出時間は constants.ts を正として CSS 変数に渡す
document.documentElement.style.setProperty("--stamp-ms", `${STAMP_ANIMATION_MS}ms`);
document.documentElement.style.setProperty("--fade-ms", `${PAPER_FADE_MS}ms`);

// ?debug で AI 診断画面（ゲームの状態には触れない）
const debug = new URLSearchParams(window.location.search).has("debug");

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      {debug ? (
        <DebugPanel
          llmMode={llmMode}
          envUrl={import.meta.env.VITE_LLM_PROXY_URL ?? ""}
          envToken={import.meta.env.VITE_LLM_PROXY_TOKEN ?? ""}
        />
      ) : (
        <App />
      )}
    </StrictMode>,
  );
}
