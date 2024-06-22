import path from "path";
import webpack from "webpack";
import "webpack-dev-server";
import CopyWebpackPlugin from "copy-webpack-plugin";
import { CleanWebpackPlugin } from "clean-webpack-plugin";
import HtmlWebpackPlugin from "html-webpack-plugin";
import TerserWebpackPlugin from "terser-webpack-plugin";

type CLIValues = boolean | string;
type EnvValues = Record<string, CLIValues | Env>;

interface Env extends EnvValues {}

type Argv = Record<string, CLIValues>;

const config = (env: Env, argv: Argv): webpack.Configuration => {
  const isProduction = argv.mode === "production";
  const dist = path.resolve(__dirname, "./dist");

  return {
    entry: "./src/index.tsx",
    output: {
      path: dist,
      filename: "sdf_tool.[contenthash].js",
    },
    devServer: {
      port: 8080,
      host: "0.0.0.0",
      static: {
        publicPath: dist,
      },
    },
    devtool: "source-map",
    resolve: {
      extensions: [".ts", ".tsx", ".js"],
    },
    module: {
      rules: [
        {
          test: /\.ts(x?)$/,
          exclude: /node_modules/,
          use: "ts-loader",
        },
        {
          enforce: "pre",
          test: /\.js$/,
          loader: "source-map-loader",
        },
        {
          test: /\.wgsl$/,
          use: "raw-loader",
        },
      ],
    },
    plugins: [
      new CleanWebpackPlugin({}),
      new HtmlWebpackPlugin({
        title: "SDF tool",
        filename: "sdf-tool.html",
        template: "index.template.html",
        minify: isProduction
          ? {
              includeAutoGeneratedTags: true,
              removeComments: true,
              collapseWhitespace: true,
              minifyJS: true,
            }
          : false,
      }),
      new CopyWebpackPlugin({
        patterns: [
          {
            from: "./node_modules/monaco-editor/min/vs",
            to: "vs",
            globOptions: {
              ignore: ["**/basic-languages/**", "**/language/**"],
            },
          },
          {
            from: "./node_modules/monaco-editor/min-maps",
            to: "min-maps",
          },
        ],
      }),
    ],

    externals: {
      "monaco-editor": [],
    },

    optimization: {
      minimize: isProduction,
      minimizer: [new TerserWebpackPlugin()],
    },
  };
};

export default config;