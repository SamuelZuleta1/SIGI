import { defineConfig } from 'vitest/config';

// Tres niveles de prueba (docs/plan_desarrollo.md §6):
//   unit        Control con persistencia y correo falsos.
//   http        rutas + middleware con Supertest (como un navegador: tests/helpers/navegador.js).
//   integracion contra el proyecto de Supabase en la nube.
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['tests/unit/**/*.test.js'], environment: 'node' } },
      {
        test: {
          name: 'http',
          include: ['tests/http/**/*.http.test.js'],
          environment: 'node',
          setupFiles: ['tests/helpers/navegador.js'],
        },
      },
      {
        test: {
          name: 'integracion',
          include: ['tests/integracion/**/*.int.test.js'],
          environment: 'node',
          setupFiles: ['tests/helpers/navegador.js'],
          fileParallelism: false,
          testTimeout: 20000,
        },
      },
    ],
  },
});
