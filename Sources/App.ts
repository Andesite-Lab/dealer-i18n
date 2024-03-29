import { Command } from 'commander';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, unlinkSync, watch, writeFileSync } from 'fs';
import { join } from 'path';
import { argv, exit } from 'process';
import { BasaltLogger, ConsoleLoggerStrategy } from '@basalt-lab/basalt-logger';

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

function sortObjectKeys(obj: TranslationStructure): TranslationStructure {
    const result: TranslationStructure = {};
    if (Object.prototype.hasOwnProperty.call(obj, 'dealerI18n:lang'))
        result['dealerI18n:lang'] = obj['dealerI18n:lang'];

    const keys: string[] = Object.keys(obj).sort();
    for (const key of keys)
        if (key !== 'dealerI18n:lang')
            if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key]))
                result[key] = sortObjectKeys(obj[key] as TranslationStructure);
            else
                result[key] = obj[key];
    return result;
}

function transformOldTranslateFileToTemplate(obj: TranslationStructure, langKey: string): TranslationStructure {
    if (Array.isArray(obj))
        return { [langKey]: obj };
    else if (typeof obj === 'object' && obj !== null)
        for (const key in obj)
            obj[key] = transformOldTranslateFileToTemplate(obj[key] as TranslationStructure, langKey);
    else
        return { [langKey]: obj };
    return obj;
}

const commander: Command = new Command();

commander.version(packageJsonConfiguration.version, '-v, --version', 'Output the current version');

commander
    .command('transform')
    .description('Create a new template based on the old translation file')
    .requiredOption('-s, --source <source>', 'Path to the old translation file')
    .requiredOption('-l, --lang <lang>', 'what is language (en, fr, es, etc)')
    .action(async (options: { source: string, lang: string }): Promise<void> => {
        try {
            BasaltLogger.addStrategy('console', new ConsoleLoggerStrategy());
            BasaltLogger.log('Checking the source file...');
            checkSourceFile(options.source);
            if (isJson(options.source)) {
                const oldTranslateFile: TranslationStructure = JSON.parse(readFileSync(options.source, 'utf-8'));
                BasaltLogger.log('Transforming the old translation file to a template...');
                let template: TranslationStructure = transformOldTranslateFileToTemplate(oldTranslateFile, `lang:${options.lang}`);
                template = updateConfDealer(options.source, template, [options.lang]);
                template = sortObjectKeys(template);
                BasaltLogger.log('Writing the template file...');
                writeInTemplateFile('./template.json', template);
            } else {
                throw new Error('The source file is not a JSON file');
            }

        } catch (e) {
            BasaltLogger.error(e);
            setTimeout((): void => {
                exit(1);
            }, 200);
        }
        exit(0);
    });


commander
    .command('start')
    .description('Start the translation process')
    .requiredOption('-s, --source <source>', 'Path to the template')
    .requiredOption('-d, --destination <destination>', 'Path to the dir destination')
    .action(async (options: IOptions): Promise<void> => {
        try {
            BasaltLogger.addStrategy('console', new ConsoleLoggerStrategy());
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

                template = sortObjectKeys(template);
                writeInTemplateFile(options.source, template);
                delete template['dealerI18n:lang'];
                regenerateFiles(template, options.destination, langs);
            } else {
                BasaltLogger.error('The source file is not a JSON file');
            }

            let update: boolean = false;

            BasaltLogger.log('Watching for changes in the source file...');
            watch(options.source, (event: 'rename' | 'change'): void => {
                if (event === 'change') {
                    if (update) {
                        update = false;
                        return;
                    }
                    if (!isJson(options.source)) {
                        BasaltLogger.error('The source file is not a JSON file');
                        return;
                    }
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
                        BasaltLogger.log('Detected changes in dealerI18n:lang');
                        if (newLangsByConfDealer.length === 0) return;
                        update = true;
                        langs = newLangsByConfDealer;
                        newTemplate = updateConfDealer(options.source, newTemplate, langs);
                        newTemplate = updateAllNodeInTemplateFile(options.source, newTemplate, langs);
                        template = newTemplate;
                    } else if (JSON.stringify(newTemplateWithoutDealerConf) !== JSON.stringify(oldTemplateWithoutDealerConf)) {
                        BasaltLogger.log('Detected changes in nodes');
                        update = true;
                        langs = newLangsByNodes;
                        newTemplate = updateConfDealer(options.source, newTemplate, langs);
                        newTemplate = updateAllNodeInTemplateFile(options.source, newTemplate, langs);
                        template = newTemplate;
                    }
                }
                if (event === 'change' && update) {
                    template = sortObjectKeys(template);
                    writeInTemplateFile(options.source, template);
                    BasaltLogger.log('Template updated');
                    delete template['dealerI18n:lang'];
                    regenerateFiles(template, options.destination, langs);
                    BasaltLogger.log('Files updated');
                }
            });

        } catch (e) {
            BasaltLogger.error(e);
            setTimeout((): void => {
                exit(1);
            }, 200);
        }

    });

commander.parse(argv);
