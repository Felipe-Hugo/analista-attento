import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <div style={{ padding: "24px 16px", background: "#F4F6F4", minHeight: "100vh" }}>
      <App />
    </div>
  </React.StrictMode>
);
