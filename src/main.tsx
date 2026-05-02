import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NuqsAdapter } from "nuqs/adapters/react";
import theme from "./theme.ts";
import App from "./App.tsx";

import "@mantine/core/styles.layer.css";
import "./global.css";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider theme={theme}>
      <QueryClientProvider client={queryClient}>
        <NuqsAdapter>
          <App />
        </NuqsAdapter>
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
);
