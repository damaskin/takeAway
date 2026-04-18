module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'subject-case': [0],
    'header-max-length': [2, 'always', 120],
    'scope-enum': [
      2,
      'always',
      [
        'api',
        'web',
        'tma',
        'admin',
        'kds',
        'mobile',
        'shared-types',
        'api-client',
        'ui-kit',
        'utils',
        'infra',
        'ci',
        'deps',
        'docs',
        'repo',
      ],
    ],
  },
};
