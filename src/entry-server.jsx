import React from "react";
import { renderToString } from "react-dom/server";
import Reader from "./Reader.jsx";

export function renderReader(book, pageId, basePath) {
  return renderToString(
    <Reader book={book} initialPageId={pageId} basePath={basePath} />,
  );
}
