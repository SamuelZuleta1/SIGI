import { defineConfig } from 'vitest/config';

// Tres niveles de prueba (docs/plan_desarrollo.md §6):
//   unit        Control con persistencia y correo falsos.
//   http        rutas + middleware con Supertest.
//   integracion contra Supabase local (`npm run db:start`).
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['tests/unit/**/*.test.js'], environment: 'node' } },
      { test: { name: 'http', include: ['tests/http/**/*.http.test.js'], environment: 'node' } },
      {
        test: {
          name: 'integracion',
          include: ['tests/integracion/**/*.int.test.js'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 20000,
        },
      },
    ],
  },
});
