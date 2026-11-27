import { defineConfig, devices } from "@playwright/test";

// Test dei flussi principali sull'app costruita (dist/), in modalità demo: niente rete.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:8765/",
    locale: "it-IT",
    geolocation: { latitude: 45.4064, longitude: 11.8768 },
    permissions: ["geolocation"],
  },
  projects: [
    { name: "iphone", use: { ...devices["iPhone 13"], browserName: "chromium" } },
    { name: "android", use: { ...devices["Pixel 7"], colorScheme: "dark" } },
  ],
  webServer: {
    command: "npm run preview",
    url: "http://localhost:8765/",
    reuseExistingServer: !process.env.CI,
  },
});
