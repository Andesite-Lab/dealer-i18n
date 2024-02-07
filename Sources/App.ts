import { Command } from 'commander';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, unlinkSync, watch, writeFileSync } from 'fs';
import { join } from 'path';
import { argv, exit } from 'process';

import { packageJsonConfiguration } from '@/Config';
import { IOptions } from '@/Interface';

type TranslationStructure = Record<string, unknown>;

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

function isLangNodeObject(obj: TranslationStructure): boolean {
    return Object.keys(obj).some((key: string): boolean => key.startsWith('lang:'));
}

function writeInTemplateFile(source: string, template: TranslationStructure): void {
    writeFileSync(source, JSON.stringify(template, null, 2));
}

function checkHasDealerConf(source: string, template: TranslationStructure): TranslationStructure {
    if(!Object.prototype.hasOwnProperty.call(template, 'dealerI18n:lang'))
        template = { 'dealerI18n:lang': [], ...template };
    if (!Array.isArray(template['dealerI18n:lang'])) {
        delete template['dealerI18n:lang'];
        template = { 'dealerI18n:lang': [], ...template };
    }
    return template;
}

function distributedTranslation(template: TranslationStructure, language: string): TranslationStructure {
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
    return distribute(template);
}

function deleteFilesInDirectory(directory: string): void {
    const files: string[] = readdirSync(directory);
    for (const file of files)
        unlinkSync(join(directory, file));
}


function regenerateFiles(template: TranslationStructure, destination: string, langs: string[]): void {
    deleteFilesInDirectory(destination);
    langs.forEach((lang: string): void => {
        const content: TranslationStructure = distributedTranslation(template, lang);
        const fileContent: string = JSON.stringify(content, null, 2);
        writeFileSync(`${destination}/${lang}.json`, fileContent);
    });
}

function triggerNewLangInNodes(template: TranslationStructure): string[] {
    const langs: string[] = [];
    const trigger = (node: TranslationStructure): void => {
        for (const key in node) {
            if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
            if (key.startsWith('lang:')) {
                if (!langs.includes(key.split(':')[1]))
                    langs.push(key.split(':')[1]);
            }
            else if (typeof node[key] === 'object') {
                trigger(node[key] as TranslationStructure);
            }
        }
    };
    trigger(template);
    return langs;
}

function triggerConfDealer(template: TranslationStructure): string[] {
    return template['dealerI18n:lang'] as string[];
}

function updateAllNodeInTemplateFile(source: string, template: TranslationStructure, langs: string[]): TranslationStructure {
    const update = (node: TranslationStructure): void => {
        for (const key in node) {
            if (key === 'dealerI18n:lang') continue;
            if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
            if (isLangNodeObject(node[key] as TranslationStructure)) {
                langs.forEach((lang: string): void => {
                    if (!Object.prototype.hasOwnProperty.call(node[key], `lang:${lang}`))
                        (node[key] as TranslationStructure)[`lang:${lang}`] = ''; // todo: if env has openai, then add the translation from openai
                    else
                        (node[key] as TranslationStructure)[`lang:${lang}`] = (node[key] as TranslationStructure)[`lang:${lang}`];
                });

                for (const lang in (node[key] as TranslationStructure))
                    if (!langs.includes(lang.split(':')[1]))
                        delete (node[key] as TranslationStructure)[lang];
            }
            else if (typeof node[key] === 'object') {
                update(node[key] as TranslationStructure);
            }

        }
    };
    update(template);
    return template;
}

function updateConfDealer(source: string, template: TranslationStructure, lang: string[]): TranslationStructure {
    checkHasDealerConf(source, template);
    template['dealerI18n:lang'] = lang;
    return template;
}

const commander: Command = new Command();

commander.version(packageJsonConfiguration.version, '-v, --version', 'Output the current version');
commander
    .requiredOption('-s, --source <source>', 'Path to the template')
    .requiredOption('-d, --destination <destination>', 'Path to the dir destination')
    .action(async (options: IOptions): Promise<void> => {
        try {
            checkSourceFile(options.source);
            checkDestinationDir(options.destination);

            let template: TranslationStructure = {};
            let langsByNodes: string[] = [];
            let langsByConfDealer: string[] = [];
            let langs: string[] = [];


            if (isJson(options.source)) {
                template = JSON.parse(readFileSync(options.source, 'utf-8'));
                template = checkHasDealerConf(options.source, template);

                langsByNodes = triggerNewLangInNodes(template);
                langsByConfDealer = triggerConfDealer(template);
                langs = langsByNodes.concat(langsByConfDealer);
                langs = Array.from(new Set(langs));

                template = updateConfDealer(options.source, template, langs);
                template = updateAllNodeInTemplateFile(options.source, template, langs);

                writeInTemplateFile(options.source, template);
                regenerateFiles(template, options.destination, langs);
            }

            let update: boolean = false;

            console.log('Watching for changes...');
            watch(options.source, (event: 'rename' | 'change'): void => {

                if (event === 'change') {
                    if (update) {
                        update = false;
                        return;
                    }

                    if (!isJson(options.source)) return;
                    let newTemplate: TranslationStructure = JSON.parse(readFileSync(options.source, 'utf-8'));

                    newTemplate = checkHasDealerConf(options.source, newTemplate);
                    const newLangsByNodes: string[] = triggerNewLangInNodes(newTemplate);
                    const newLangsByConfDealer: string[] = triggerConfDealer(newTemplate);

                    const newTemplateWithoutDealerConf: TranslationStructure = { ...newTemplate };
                    delete newTemplateWithoutDealerConf['dealerI18n:lang'];
                    const oldTemplateWithoutDealerConf: TranslationStructure = { ...template };
                    delete oldTemplateWithoutDealerConf['dealerI18n:lang'];

                    if (
                        JSON.stringify(newLangsByConfDealer) !== JSON.stringify(langsByConfDealer) &&
                        JSON.stringify(newTemplateWithoutDealerConf) === JSON.stringify(oldTemplateWithoutDealerConf)
                    ) {
                        console.log('Detected changes in dealerI18n:lang');
                        if (newLangsByConfDealer.length === 0) return;
                        update = true;
                        langs = newLangsByConfDealer;
                        newTemplate = updateConfDealer(options.source, newTemplate, langs);
                        newTemplate = updateAllNodeInTemplateFile(options.source, newTemplate, langs);
                        template = newTemplate;
                    } else if (JSON.stringify(newTemplateWithoutDealerConf) !== JSON.stringify(oldTemplateWithoutDealerConf)) {
                        console.log('Detected changes in nodes');
                        update = true;
                        langs = newLangsByNodes;
                        newTemplate = updateConfDealer(options.source, newTemplate, langs);
                        newTemplate = updateAllNodeInTemplateFile(options.source, newTemplate, langs);
                        template = newTemplate;
                    }
                }
                if (event === 'change' && update) {
                    writeInTemplateFile(options.source, template);
                    delete template['dealerI18n:lang'];
                    regenerateFiles(template, options.destination, langs);
                }
            });

        } catch (e) {
            console.error(e);
            exit(1);
        }

    })
    .parse(argv);
