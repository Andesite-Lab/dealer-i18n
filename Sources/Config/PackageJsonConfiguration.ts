import {
    version,
    author,
    dependencies,
    devDependencies,
    name,
    description,
    main,
    license,
    scripts
} from '../../package.json';

export interface IPackageJson {
    version: string;
    author: string;
    name: string;
    description: string;
    main: string;
    license: string;
    scripts: {
        [key: string]: string;
    }
    dependencies: {
        [key: string]: string;
    },
    devDependencies: {
        [key: string]: string;
    },
}

export const packageJsonConfiguration: IPackageJson = {
    version,
    author,
    dependencies,
    devDependencies,
    name,
    description,
    main,
    license,
    scripts
};
