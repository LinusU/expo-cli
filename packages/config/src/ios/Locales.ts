import JsonFile from '@expo/json-file';
import * as fs from 'fs-extra';
import { join } from 'path';

import { ExpoConfig } from '../Config.types';
import { addWarningIOS } from '../WarningAggregator';
import {
  addFileToGroup,
  ensureGroupRecursively,
  getPbxproj,
  getProjectName,
} from './utils/Xcodeproj';

type LocaleJson = Record<string, string>;
type ResolvedLocalesJson = Record<string, LocaleJson>;
type ExpoConfigLocales = NonNullable<ExpoConfig['locales']>;

export function getLocales(config: ExpoConfig): Record<string, string | LocaleJson> | null {
  return config.locales ?? null;
}

export async function setLocalesAsync(config: ExpoConfig, projectRoot: string): Promise<void> {
  const locales = getLocales(config);
  if (!locales) {
    return;
  }
  // possibly validate CFBundleAllowMixedLocalizations is enabled
  const localesMap = await getResolvedLocalesAsync(projectRoot, locales);

  let project = getPbxproj(projectRoot);
  const projectName = getProjectName(projectRoot);
  const supportingDirectory = join(projectRoot, 'ios', projectName, 'Supporting');

  // TODO: Should we delete all before running? Revisit after we land on a lock file.
  const stringName = 'InfoPlist.strings';

  for (const [lang, localizationObj] of Object.entries(localesMap)) {
    const dir = join(supportingDirectory, `${lang}.lproj`);
    await fs.ensureDir(dir);
    const strings = join(dir, stringName);
    const buffer = [];
    for (const [plistKey, localVersion] of Object.entries(localizationObj)) {
      buffer.push(`${plistKey} = "${localVersion}";`);
    }
    // Write the file to the file system.
    await fs.writeFile(strings, buffer.join('\n'));

    // deep find the correct folder
    const group = ensureGroupRecursively(project, `${projectName}/Supporting/${lang}.lproj`);

    // Ensure the file doesn't already exist
    if (!group?.children.some(({ comment }) => comment === stringName)) {
      // Only write the file if it doesn't already exist.
      project = addFileToGroup(strings, `${projectName}/Supporting/${lang}.lproj`, project);
    }
  }

  // Sync the Xcode project with the changes.
  fs.writeFileSync(project.filepath, project.writeSync());
}

export async function getResolvedLocalesAsync(
  projectRoot: string,
  input: ExpoConfigLocales
): Promise<ResolvedLocalesJson> {
  const locales: ResolvedLocalesJson = {};
  for (const [lang, localeJsonPath] of Object.entries(input)) {
    if (typeof localeJsonPath === 'string') {
      try {
        locales[lang] = await JsonFile.readAsync(join(projectRoot, localeJsonPath));
      } catch (e) {
        // Add a warning when a json file cannot be parsed.
        addWarningIOS(
          `locales-${lang}`,
          `Failed to parse JSON of locale file for language: ${lang}`,
          'https://docs.expo.io/distribution/app-stores/#localizing-your-ios-app'
        );
      }
    } else {
      // In the off chance that someone defined the locales json in the config, pass it directly to the object.
      // We do this to make the types more elegant.
      locales[lang] = localeJsonPath;
    }
  }

  return locales;
}
