/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHAIN_ID?: string;
  readonly VITE_RPC?: string;
  readonly VITE_MULLIGAN?: string;
  readonly VITE_FROM_BLOCK?: string;
}
