import {
  Builder,
  crayon,
  deepMerge,
  EntrypointConfig,
  FileBag,
  fromFileUrl,
  join,
  relative,
  resolve,
  sprintf,
  VirtualFile,
} from "./deps.ts";
import { Logger } from "../logger.ts";
import type { BuildOptions, BuildResult, DenoConfig } from "./types.ts";

type DefaultBuildOptions = Omit<
  BuildOptions,
  "browserEntrypoint" | "serverEntrypoint" | "plugin"
>;

const defaultOptions: DefaultBuildOptions = {
  root: Deno.cwd(),
  output: ".ultra",
  importMapPath: "./importMap.json",
  ignored: [".git", join("**", ".DS_Store")],
};

export class UltraBuilder extends Builder {
  public options: BuildOptions;

  public browserEntrypoint?: string;
  public serverEntrypoint: string;

  constructor(
    options: Partial<BuildOptions>,
    private onSuccessCallback?: (
      context: UltraBuilder,
      result: BuildResult,
    ) => Promise<void> | void,
  ) {
    const resolvedOptions = deepMerge<BuildOptions>(defaultOptions, options);
    const root = resolvedOptions.root;

    const output = resolvedOptions.output
      ? resolve(root, resolvedOptions.output)
      : resolve(root, ".ultra");

    super({
      root,
      output,
      name: "ultra",
      importMapPath: resolvedOptions.importMapPath,
      logLevel: "INFO",
      compiler: {
        minify: true,
        jsxImportSource: resolvedOptions.jsxImportSource,
        sourceMaps: resolvedOptions.sourceMaps,
      },
    });

    // Override the logger
    this.log = new Logger("INFO");

    this.options = resolvedOptions;
    this.browserEntrypoint = this.options.browserEntrypoint
      ? this.makeRelative(this.options.browserEntrypoint)
      : undefined;
    this.serverEntrypoint = this.makeRelative(this.options.serverEntrypoint);

    this.#initEntrypoints();
    this.#initIgnored();
    this.#initHashed();
  }

  entrypoint(path: string, config: EntrypointConfig) {
    this.entrypoints.set(path, config);

    return this;
  }

  ignore(path: string) {
    this.ignored.push(super.globToRegExp(path));

    return this;
  }

  dynamicImportIgnore(path: string) {
    this.dynamicImportIgnored.push(super.globToRegExp(path));

    return this;
  }

  contentHash(path: string) {
    this.hashed.push(super.globToRegExp(path));

    return this;
  }

  async build(): Promise<BuildResult> {
    /**
     * Clean the output directory
     */
    await this.cleanOutput();

    /**
     * Gather all sources from root
     */
    const sources = await this.gatherSources();

    /**
     * Copy sources to output
     */
    const buildSources = await this.copySources(sources);

    /**
     * Execute the build
     */
    const result = await super.build(buildSources);

    /**
     * Remove the dev importMap
     */
    await buildSources.get(this.options.importMapPath).then((source) =>
      source.remove()
    );

    /**
     * Generate ./asset-manifest.json
     */
    await this.#generateAssetManifest(buildSources);

    /**
     * Patch deno.json
     */
    await this.#patchDenoJsonConfig(buildSources);

    /**
     * If a build plugin is provided, execute it's build hooks
     */
    if (this.options.plugin) {
      const plugin = this.options.plugin;
      try {
        this.log.info(
          sprintf(
            "Starting build plugin %s",
            crayon.lightBlue(plugin.name),
          ),
        );
        await plugin.onBuild(this, result);
      } catch (error) {
        this.log.error(
          sprintf(
            "Build plugin %s failed, see below for details",
            crayon.lightBlue(plugin.name),
          ),
        );
        this.log.error(error);
        Deno.exit(1);
      }
    }

    this.log.success("Build complete");

    if (this.onSuccessCallback) {
      await this.onSuccessCallback(this, result);
    }

    return result;
  }

  #initEntrypoints() {
    if (this.browserEntrypoint) {
      this.entrypoint(this.browserEntrypoint, {
        vendorOutputDir: "browser",
        target: "browser",
      });
    }

    this.entrypoint(this.serverEntrypoint, {
      vendorOutputDir: "server",
      target: "deno",
    });
  }

  #initIgnored() {
    /**
     * Deno.mainModule will most definitely be a build.ts file in the project
     * We always exclude this.
     */
    const mainModule = this.makeRelative(Deno.mainModule);

    this.setIgnored([
      mainModule,
      ...(this.options.ignored || []),
    ]);

    // Exclude the compiler middleware from the build output
    this.dynamicImportIgnore(import.meta.resolve("../middleware/compiler.ts"));
  }

  #initHashed() {
    const hashed = [
      "./src/**/*.+(ts|tsx|js|jsx|css)",
      "./public/**/*.+(css|ico|webp|avif|jpg|png|svg|gif|otf|ttf|woff)",
    ];

    if (this.browserEntrypoint) {
      hashed.push(this.browserEntrypoint);
    }

    this.setHashed(hashed);

    this.setCompiled([
      "./**/*.+(ts|tsx|js|jsx)",
    ]);
  }

  async #generateAssetManifest(sources: FileBag) {
    this.log.info("Generating asset-manifest.json");

    const manifest = this.toManifest(sources, {
      ignore: [
        "./deno.json",
        "./importMap*.json",
      ],
      prefix: "/",
    });

    const assetManifest = manifest.map(([relative, absolute]) => {
      return [
        relative.replace("./public/", "./"),
        absolute.replace("/public/", "/"),
      ];
    });

    const assetManifestSource = new VirtualFile(
      "./asset-manifest.json",
      this.context.output,
      JSON.stringify(assetManifest, null, 2),
    );

    await this.copySource(assetManifestSource, this.context.output);
  }

  async #patchDenoJsonConfig(sources: FileBag) {
    this.log.info("Patching deno.json");
    const source = await sources.get("./deno.json");

    if (source) {
      const denoConfig = await source.readAsJson<DenoConfig>();
      if (denoConfig) {
        if (denoConfig.compilerOptions?.jsx) {
          denoConfig.compilerOptions.jsx = "react-jsx";
        }
        denoConfig.importMap = "./importMap.server.json";
        await source.writeJson(denoConfig, true);
      }
    }

    return source;
  }

  makeRelative(path: string) {
    return `./${
      relative(
        this.context.root,
        fromFileUrl(path),
      )
    }`;
  }
}
