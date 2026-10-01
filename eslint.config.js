import js from '@eslint/js';
import globals from 'globals';

export default [
    { ignores: ['three.module.min.js', 'node_modules/'] },
    js.configs.recommended,
    {
        files: ['src/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: { ...globals.browser, THREE: 'readonly' }, // published by src/core/three.js (main.js imports it first)
        },
        rules: {
            'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
        },
    },
    {
        files: ['scripts/**/*.mjs', 'tests/**/*.mjs', 'server/**/*.mjs', 'eslint.config.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            // tests pass callbacks to page.evaluate(), which run in the browser
            globals: { ...globals.node, ...globals.browser, THREE: 'readonly' },
        },
    },
];
