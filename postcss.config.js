export default {
  plugins: {
    'postcss-preset-env': {
      stage: 2,
      features: {
        'nesting-rules': true,
        'custom-properties': false,
        'color-function': true,
      },
    },
    autoprefixer: {},
  },
};
