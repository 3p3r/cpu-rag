import * as path from 'node:path';
import type { Configuration } from 'webpack';
import nodeExternals from 'webpack-node-externals';

const config: Configuration = {
  entry: './src/index.ts',
  target: 'node',
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  devtool: 'source-map',
  externals: [nodeExternals()],
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  output: {
    filename: 'index.js',
    path: path.resolve(__dirname, 'dist'),
    library: {
      type: 'commonjs2',
    },
    clean: true,
  },
  optimization: {
    minimize: process.env.NODE_ENV === 'production',
  },
};

export default config;
