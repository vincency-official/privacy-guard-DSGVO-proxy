import { defineConfig } from 'vitest/config';

// Minimale Vitest-Konfiguration: Node-Umgebung, Tests unter tests/.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
