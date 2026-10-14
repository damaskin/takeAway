// The English dictionary is its own entry point: re-exported from the main
// index it would stay in every app's initial bundle, although the app loads it
// lazily (see i18n.providers.ts).
export * from './lib/translations/en';
