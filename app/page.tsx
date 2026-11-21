"use client";

import { useEffect } from "react";

export default function HomePage() {
  useEffect(() => {
    let stop = (): void => {};
    let cancelled = false;
    void import("../src/main").then(({ boot }) => boot()).then((cleanup) => {
      if (cancelled) cleanup();
      else stop = cleanup;
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  return (
    <div className="app">
      <header className="top">
        <h1>香港交通地圖</h1>
        <form id="search-form" role="search">
          <label className="visually-hidden" htmlFor="search">搜尋車站</label>
          <input id="search" type="search" placeholder="搜尋車站，例如金鐘" autoComplete="off" enterKeyHint="search" />
          <ul id="search-results" hidden />
        </form>
      </header>
      <div className="stage">
        <div id="banners" />
        <div id="map" />
      </div>
      <aside id="panel">
        <div id="panel-body" />
        <div id="layers" />
      </aside>
    </div>
  );
}
