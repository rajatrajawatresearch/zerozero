/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_WS_BASE_URL: string;
  readonly VITE_APP_NAME: string;
  readonly VITE_DEFAULT_LAT: string;
  readonly VITE_DEFAULT_LNG: string;
  readonly VITE_MAP_TILES_URL: string;
  readonly VITE_MAP_ATTRIBUTION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
