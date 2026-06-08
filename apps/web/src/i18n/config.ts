/**
 * @copyright Copyright (c) 2024-2026 Ronan LE MEILLAT
 * @license AGPL-3.0-or-later
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 *
 * @description
 * This file configures the i18n instance with the following settings:
 *  * The default language is English (en-US)
 *  * The available languages are defined in the availableLanguages array
 *  * Translations are bundled directly (no HTTP backend) for synchronous availability
 *  * The i18n instance is exported as the default export
 * How to add a new language ?
 *  * Add a new object to the availableLanguages array with the following properties:
 *    * code: The ISO 639-1 language code (e.g., "en-US")
 *    * nativeName: The native name of the language (e.g., "English")
 *    * isRTL: Whether the language is right-to-left (e.g., false)
 *  * Create a new JSON file in the locales/ directory with the language code (e.g., "de-DE.json")
 *  * Import the JSON file and add it to the `resources` object in the i18n init config
 *  * The new language should now be available for selection in the LanguageSwitch component
 * @see src/components/language-switch.tsx
 * @see src/locales/en-US.json
 */

import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import enUS from "./locales/en-US.json";
import frFR from "./locales/fr-FR.json";
import esES from "./locales/es-ES.json";

export interface AvailableLanguage {
  code: string; // ISO 639-1 language code
  nativeName: string; // Native name of the language
  isRTL: boolean; // Right-to-left language
  isDefault?: boolean; // Default language
}

/**
 * Complete list of languages supported by the application.
 * The entry with `isDefault: true` is used as the i18next `fallbackLng`.
 * RTL languages have `isRTL: true` which flips the UI layout direction.
 *
 * @see {@link AvailableLanguage}
 */
export const availableLanguages: AvailableLanguage[] = [
  { code: "en-US", nativeName: "English", isRTL: false, isDefault: true },
  { code: "fr-FR", nativeName: "Français", isRTL: false },
  { code: "es-ES", nativeName: "Español", isRTL: false },
  { code: "zh-CN", nativeName: "中文", isRTL: false },
  { code: "ar-SA", nativeName: "العربية", isRTL: true },
  { code: "he-IL", nativeName: "עברית", isRTL: true },
];

const fallbackLng = "en-US";

i18n
  .use(initReactI18next)
  .init({
    lng:
      localStorage.getItem("preferredLanguage") ||
      availableLanguages.find((lang) => lang.isDefault)?.code ||
      fallbackLng,
    fallbackLng: fallbackLng,

    ns: ["common"],
    defaultNS: "common",
    resources: {
      "en-US": { common: enUS.common },
      "fr-FR": { common: frFR.common },
      "es-ES": { common: esES.common },
    },
    interpolation: {
      escapeValue: false,
    },
    react: {
      transKeepBasicHtmlNodesFor: ["br", "strong", "i", "p", "sub", "sup"],
    },
  });

export default i18n;
