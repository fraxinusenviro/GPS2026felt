/// <reference types="vite/client" />

declare const __APP_BUILD_DATE__: string;
declare const __APP_VERSION__: string;

declare module '*.png' {
  const url: string;
  export default url;
}
