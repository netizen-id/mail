module.exports = {
  '*.md,!test/snapshots/**/*.md,!test/**/snapshots/**/*.md,!locales/README.md':
    [(filenames) => filenames.map((filename) => `remark ${filename} -qfo`)],
  'package.json': 'fixpack',
  '*.pug': ['prettier --write', 'pug-lint'],
  '*.js': 'xo --fix',
  '*.scss': 'stylelint --fix'
};
