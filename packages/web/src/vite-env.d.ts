/// <reference types="vite/client" />

interface Window {
  __SCHEMAT_SCHEMA__?: import("@alirezahamid/schemat-core").IRSchema;
  __SCHEMAT_LAYOUT__?: Record<string, { x: number; y: number }>;
}
