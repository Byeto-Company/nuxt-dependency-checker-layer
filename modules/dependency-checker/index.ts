import { createResolver, defineNuxtModule, useLogger } from "@nuxt/kit";
import path from "path";
import fs from "fs/promises";
import { spawn } from "child_process";
import semver from "semver";

// import { defu } from "defu";
// import { addCustomTab } from "@nuxt/devtools-kit";

type Package = {
    scope: string;
    name: string;
    version: string;
};

type ModuleOptions = {};

export default defineNuxtModule<ModuleOptions>({
    meta: {
        // name: "nuxt-dependency-checker-module",
        // configKey: "dependencyCheckerModule",
    },

    // defaults: {
    // },

    async setup(moduleOptions, nuxt) {
        const resolver = createResolver(import.meta.url);
        const logger = useLogger("nuxt-dependency-checker-module", {});

        // Read packages from root directory

        const currentProjectPackagesList: Package[] = [];

        const packageJsonContent = await fs.readFile(path.join(nuxt.options.rootDir, "package.json"), "utf-8");
        const parsedPackageJsonContent = JSON.parse(packageJsonContent);

        for (const dependency of Object.keys(parsedPackageJsonContent.dependencies)) {
            currentProjectPackagesList.push({
                scope: "Project",
                name: dependency,
                version: parsedPackageJsonContent.dependencies[dependency],
            });
        }

        // Read packages from each layer

        const packagesList: Package[] = [];

        for (const layer of nuxt.options._layers) {
            const parentFolderPath = path.dirname(layer.config.rootDir);
            const parentFolderName = path.basename(parentFolderPath);

            if (parentFolderName === ".c12") {
                const packageJsonPath = path.join(layer.config.rootDir, "package.json");
                const packageJsonContent = await fs.readFile(packageJsonPath, "utf-8");
                const parsedPackageJsonContent = JSON.parse(packageJsonContent);

                for (const dependency of Object.keys(parsedPackageJsonContent.dependencies)) {
                    if (!packagesList.find((pkg) => pkg.name === dependency)) {
                        packagesList.push({
                            scope: "Layer",
                            name: dependency,
                            version: parsedPackageJsonContent.dependencies[dependency],
                        });
                    }
                }
            }
        }

        // Check versions and decide which packages to install

        const packagesToInstall: {
            canInstall: boolean;
            status?: "MAJOR" | "MINOR" | "PATH";
            package: Package;
        }[] = [];

        for (const dependency of packagesList) {
            const projectDependency = currentProjectPackagesList.find((pkg) => pkg.name === dependency.name);

            if (projectDependency) {
                const projectVersion = semver.minVersion(projectDependency.version);
                const layerVersion = semver.minVersion(dependency.version);

                if (
                    layerVersion!.major > projectVersion!.major ||
                    layerVersion!.minor > projectVersion!.minor ||
                    layerVersion!.patch > projectVersion!.patch
                ) {
                    packagesToInstall.push({
                        canInstall: true,
                        package: dependency,
                    });
                }
            } else {
                packagesToInstall.push({
                    canInstall: true,
                    package: dependency,
                });
            }
        }

        const installPackages = () => {
            return new Promise((resolve, reject) => {
                const packagesListString = packagesToInstall
                    .filter((item) => item.canInstall)
                    .map((item) => `${item.package.name}@${item.package.version.replace("^", "")}`);

                console.log(packagesListString)

                const spawnProcess = spawn(`bun`, ["add", ...packagesListString, "--ignore-scripts"], {
                    stdio: "inherit",
                    shell: false,
                });

                spawnProcess.on("error", (err) => {
                    reject(err);
                });

                spawnProcess.on("close", (code) => {
                    if (code === 0) {
                        resolve("ok");
                    } else {
                        reject(new Error(`Command failed with exit code ${code}`));
                    }
                });
            });
        };

        if (packagesToInstall.length > 0) {
            logger.box(
                `These packages will be installed:\n\n${packagesToInstall
                    .map(
                        (item) =>
                            `${item.package.scope} ${item.canInstall ? "✅" : "⚠️"} ${item.package.name}@${
                                item.package.version
                            }`
                    )
                    .join("\n")}`
            );

            logger.info("Installing dependencies...");

            await installPackages();

            logger.success("All dependencies are installed");
        } else {
            logger.box(`There are no any layer package to be installed`);
        }
    },
});
