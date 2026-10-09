"use client";

import { useEffect } from "react";

export default function RutaSegura({ config, markup }) {
  useEffect(() => {
    window.RutaSeguraConfig = config;
    window.RutaSeguraNative = { isNative: false };
    import("../src/app-main.js");
  }, [config.url, config.anonKey]);

  return <div dangerouslySetInnerHTML={{ __html: markup }} />;
}
