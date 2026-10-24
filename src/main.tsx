import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// P0 雛形: UI は P2 で実装する
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<StrictMode />);
}
