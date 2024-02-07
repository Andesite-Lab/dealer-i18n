import { Command } from 'commander';
import { existsSync, lstatSync, mkdirSync, readFileSync, watch, writeFileSync } from 'fs';
import { argv, exit } from 'process';

import { packageJsonConfiguration } from '@/Config';
import { IOptions } from '@/Interface';


function isJson(source: string): boolean {
    if (!source.endsWith('.json')) return false;
    try {
        JSON.parse(readFileSync(source, 'utf-8'));
        return true;
    } catch {
        return false;
    }
}

function checkSourceFile(source: string): void {
    if (!existsSync(source) || !lstatSync(source).isFile())
        throw new Error('Source file not found');
}

function checkDestinationDir(destination: string): void {
    if (!existsSync(destination) || !lstatSync(destination).isDirectory())
        mkdirSync(destination, { recursive: true });
}

function updateGlobalStructure(structure: Record<string, unknown>, newStructure: Record<string, unknown>): Record<string, unknown> {
    return { ...structure, ...newStructure };
}

type TranslationStructure = Record<string, unknown>;

function distributedTranslation(structure: TranslationStructure, language: string): TranslationStructure {
    const distribute = (node: TranslationStructure): TranslationStructure => {
        const result: TranslationStructure = {};
        for (const key in node) {
            if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
            if (key.startsWith('lang:')) {
                if (key === `lang:${language}`)
                    return <TranslationStructure>node[key];

            } else if (typeof node[key] === 'object') {
                result[key] = distribute(node[key] as TranslationStructure);
            } else {
                result[key] = node[key];
            }
        }
        return result;
    };
    return distribute(structure);
}



function generateFiles(structure: Record<string, unknown>, destination: string, language: string | undefined): void {
    const langs: string[] = language ? language.split(',') : ['en'];

    langs.forEach((lang: string): void => {
        const content: Record<string, unknown> = distributedTranslation(structure, lang);
        const fileContent: string = JSON.stringify(content, null, 2);
        writeFileSync(`${destination}/${lang}.json`, fileContent);
    });
}

const commander: Command = new Command();

commander.version(packageJsonConfiguration.version, '-v, --version', 'Output the current version');
commander
    .requiredOption('-s, --source <source>', 'Path to the template')
    .requiredOption('-d, --destination <destination>', 'Path to the dir destination')
    .option('-l, --language <lang d="en">', 'Language for generated files')
    .action(async (options: IOptions): Promise<void> => {
        try {
            checkSourceFile(options.source);
            checkDestinationDir(options.destination);

            let structure: Record<string, unknown> = {};

            if (isJson(options.source)) {
                structure = JSON.parse(readFileSync(options.source, 'utf-8'));
                generateFiles(structure, options.destination, options.language);
            }

            watch(options.source, (event: 'rename' | 'change'): void => {
                if (event === 'change') {
                    if (!isJson(options.source)) return;
                    const newStructure: Record<string, unknown> = JSON.parse(readFileSync(options.source, 'utf-8'));
                    structure = updateGlobalStructure(structure, newStructure);
                }
                generateFiles(structure, options.destination, options.language);
            });

        } catch (e) {
            console.error(e);
            exit(1);
        }

    })
    .parse(argv);
