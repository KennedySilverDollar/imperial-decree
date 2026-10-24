/// <reference types="vite/client" />

// フロントの環境変数（.env.example 参照）。どちらも未設定ならモック参謀で動く
interface ImportMetaEnv {
  readonly VITE_LLM_PROXY_URL?: string;
  /** 簡易トークン。ビルドに埋め込まれて公開されるので、秘密情報ではない（DECISIONS D-39） */
  readonly VITE_LLM_PROXY_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
