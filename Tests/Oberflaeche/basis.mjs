// Die App kennt ⌘ nur auf Mac (navigator.platform) und die Tests drücken „Meta“.
// Auf dem Linux-Runner geben wir dem Browser daher die Mac-Plattform.
import { test as basis, expect } from "@playwright/test";
export const test = basis.extend({
  context: async ({ context }, use) => {
    await context.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "platform", { get: () => "MacIntel", configurable: true });
    });
    await use(context);
  },
});
export { expect };
