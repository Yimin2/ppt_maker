import { defineConfig } from "vite";

export default defineConfig({
  base: "/ppt_maker/",
  root: ".",
  server: {
    port: 5173,
    open: true,
  },
});
